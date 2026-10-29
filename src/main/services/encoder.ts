import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildFfmpegPasses, nullDeviceFor, verifyOutputMedia } from '../../shared/ffmpeg-args'
import { buildEncodePlan } from '../../shared/plan'
import {
  estimateEta,
  explainFfmpegError,
  percentFromTime,
  ProgressParser
} from '../../shared/progress'
import { spaceSaved, evaluateTarget } from '../../shared/space'
import { assertCleanupSafe } from '../../shared/paths'
import type {
  CompressionResult,
  CompressionSettings,
  MediaInfo,
  ProgressSnapshot
} from '../../shared/types'
import { probeFile } from './ffprobe'
import { runProcess } from './process-runner'

export class EncodeCancelled extends Error {
  constructor() {
    super(
      'Compression was cancelled. Temporary files were removed and the original video was not changed.'
    )
    this.name = 'EncodeCancelled'
  }
}

export async function encodeVideo(input: {
  ffmpegPath: string
  ffprobePath: string
  media: MediaInfo
  settings: CompressionSettings
  outputPath: string
  inputPlaybackUrl: string
  outputPlaybackUrl: string
  overwrite: boolean
  onProgress: (progress: ProgressSnapshot) => void
  signal: AbortSignal
}): Promise<CompressionResult> {
  if (input.signal.aborted) throw new EncodeCancelled()
  const plan = buildEncodePlan(input.media, input.settings)
  if (plan.errors.length > 0) throw new Error(plan.errors[0])

  const jobTemp = join(tmpdir(), 'smart-mp4-compressor', randomUUID())
  const partial = `${input.outputPath}.${randomUUID()}.partial.mp4`
  const cleanupPaths = [partial, jobTemp]
  assertCleanupSafe(cleanupPaths, input.media.path)
  await mkdir(jobTemp, { recursive: true })

  const started = Date.now()
  const passes = buildFfmpegPasses({
    inputPath: input.media.path,
    tempOutputPath: partial,
    passLogPrefix: join(jobTemp, 'pass'),
    nullDevice: nullDeviceFor(process.platform),
    options: plan.options
  })

  try {
    for (let index = 0; index < passes.length; index += 1) {
      if (input.signal.aborted) throw new EncodeCancelled()
      const pass = passes[index]
      await runPass({
        ffmpegPath: input.ffmpegPath,
        args: pass.args,
        cwd: jobTemp,
        durationSeconds: input.media.durationSeconds,
        passIndex: index + 1,
        passCount: passes.length,
        partialPath: pass.label === 'pass1' ? null : partial,
        started,
        onProgress: input.onProgress,
        signal: input.signal
      })
    }

    input.onProgress(progressShell(started, passes.length, 'verifying', null))
    const probed = await probeFile(input.ffprobePath, partial)
    const problems = verifyOutputMedia(probed, {
      audio: plan.options.audioMode === 'remove' ? 'removed' : 'present',
      maxLongSide: plan.maxLongSide,
      maxShortSide: plan.maxShortSide,
      frameRate: plan.options.frameRate
    })
    if (problems.length > 0) {
      throw new Error(`The output failed verification. ${problems.join(' ')}`)
    }
    await moveIntoPlace(partial, input.outputPath, input.overwrite)
    try {
      const finalInfo = await stat(input.outputPath)
      const outputMedia = await probeFile(input.ffprobePath, input.outputPath)
      const saved = spaceSaved(input.media.fileSizeBytes, finalInfo.size)
      const target = plan.targetBytes
      const targetEvaluation = target == null ? null : evaluateTarget(finalInfo.size, target)
      return {
        inputSizeBytes: input.media.fileSizeBytes,
        outputSizeBytes: finalInfo.size,
        savedBytes: saved.savedBytes,
        savedPercent: saved.savedPercent,
        outputWidth: outputMedia.displayWidth,
        outputHeight: outputMedia.displayHeight,
        outputVideoCodec: outputMedia.videoCodec,
        outputAudioCodec: outputMedia.audioCodec,
        outputFrameRate: outputMedia.frameRate,
        encodingDurationSeconds: (Date.now() - started) / 1000,
        outputBitrate: outputMedia.overallBitrate,
        targetBytes: target,
        targetMet: targetEvaluation?.met ?? null,
        targetMessage: targetEvaluation?.message ?? null,
        outputPath: input.outputPath,
        outputPlaybackUrl: input.outputPlaybackUrl,
        inputPlaybackUrl: input.inputPlaybackUrl,
        warnings: plan.warnings,
        videoBitrateBps: plan.videoBitrateBps
      }
    } catch (error) {
      assertCleanupSafe([input.outputPath], input.media.path)
      await rm(input.outputPath, { force: true })
      throw error instanceof Error
        ? error
        : new Error('The output failed verification and was removed.')
    }
  } catch (error) {
    if (input.signal.aborted) throw new EncodeCancelled()
    throw error
  } finally {
    assertCleanupSafe([partial, jobTemp], input.media.path)
    await rm(partial, { force: true })
    await rm(jobTemp, { recursive: true, force: true })
  }
}

async function runPass(input: {
  ffmpegPath: string
  args: string[]
  cwd: string
  durationSeconds: number | null
  passIndex: number
  passCount: number
  partialPath: string | null
  started: number
  onProgress: (progress: ProgressSnapshot) => void
  signal: AbortSignal
}): Promise<void> {
  const parser = new ProgressParser()
  const running = runProcess(input.ffmpegPath, input.args, { cwd: input.cwd, signal: input.signal })
  running.child.stdout?.setEncoding('utf8')
  running.child.stdout?.on('data', (chunk: string) => {
    const parsed = parser.push(chunk)
    if (!parsed) return
    void publish(input, parsed)
  })
  let result: { code: number | null; signal: NodeJS.Signals | null; stderr: string }
  try {
    result = await running.done
  } catch (error) {
    if (input.signal.aborted) throw new EncodeCancelled()
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      throw new Error('FFmpeg could not be started. Check that it is installed and executable.', {
        cause: error
      })
    }
    throw error
  }
  if (input.signal.aborted || result.signal === 'SIGTERM' || result.signal === 'SIGKILL') {
    throw new EncodeCancelled()
  }
  if (result.code !== 0) throw new Error(explainFfmpegError(result.stderr, result.code))
}

async function publish(
  input: {
    durationSeconds: number | null
    passIndex: number
    passCount: number
    partialPath: string | null
    started: number
    onProgress: (progress: ProgressSnapshot) => void
  },
  parsed: ReturnType<ProgressParser['push']>
): Promise<void> {
  if (!parsed) return
  const passPercent = percentFromTime(parsed.outTimeSeconds, input.durationSeconds)
  const percent =
    passPercent == null
      ? null
      : input.passCount === 1
        ? passPercent
        : ((input.passIndex - 1) * 100 + passPercent) / input.passCount
  const elapsedSeconds = (Date.now() - input.started) / 1000
  let outputSizeBytes = parsed.totalSizeBytes
  if (input.partialPath) {
    try {
      const file = await stat(input.partialPath)
      if (file.size > 0) outputSizeBytes = file.size
    } catch {
      /* the file appears after the muxer opens it */
    }
  }
  input.onProgress({
    percent:
      parsed.finished && passPercent != null
        ? input.passCount === 1
          ? 100
          : (input.passIndex / input.passCount) * 100
        : percent,
    elapsedSeconds,
    etaSeconds: estimateEta({
      percent,
      elapsedSeconds,
      speed: parsed.speed,
      durationSeconds: input.durationSeconds,
      outTimeSeconds: parsed.outTimeSeconds
    }),
    speed: parsed.speed,
    fps: parsed.fps,
    outputSizeBytes,
    indeterminate: percent == null,
    passIndex: input.passIndex,
    passCount: input.passCount,
    stage: 'encoding'
  })
}

function progressShell(
  started: number,
  passCount: number,
  stage: ProgressSnapshot['stage'],
  percent: number | null
): ProgressSnapshot {
  return {
    percent,
    elapsedSeconds: (Date.now() - started) / 1000,
    etaSeconds: null,
    speed: null,
    fps: null,
    outputSizeBytes: null,
    indeterminate: percent == null,
    passIndex: passCount,
    passCount,
    stage
  }
}

async function moveIntoPlace(
  partial: string,
  outputPath: string,
  overwrite: boolean
): Promise<void> {
  if (overwrite) await rm(outputPath, { force: true })
  else {
    try {
      await stat(outputPath)
      throw new Error('The output file already exists. Confirm overwrite before replacing it.')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        if (error instanceof Error && error.message.includes('already exists')) throw error
        throw error
      }
    }
  }
  try {
    await rename(partial, outputPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    await copyFile(partial, outputPath)
    await rm(partial, { force: true })
  }
}
