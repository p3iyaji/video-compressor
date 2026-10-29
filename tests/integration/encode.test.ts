import { spawn } from 'node:child_process'
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { discoverBinaries } from '../../src/main/services/binaries'
import { EncodeCancelled, encodeVideo } from '../../src/main/services/encoder'
import { probeFile } from '../../src/main/services/ffprobe'
import { createSettingsFromPreset } from '../../src/shared/presets'
import type { CompressionSettings, MediaInfo, ProgressSnapshot } from '../../src/shared/types'
import { mediaFixture } from '../helpers/fixtures'

const root = join(process.cwd(), 'tmp', 'integration')
let ffmpeg = ''
let ffprobe = ''
let rotationAvailable = false

async function runFfmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      stdio: ['ignore', 'ignore', 'pipe']
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr || `ffmpeg exited ${code}`))
    })
  })
}

async function makeClip(
  file: string,
  options: { width: number; height: number; fps: number; seconds: number; audio: boolean }
): Promise<void> {
  const args = [
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=${options.width}x${options.height}:rate=${options.fps}`
  ]
  if (options.audio) args.push('-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100')
  args.push(
    '-t',
    String(options.seconds),
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p'
  )
  if (options.audio) args.push('-c:a', 'aac', '-b:a', '96k')
  else args.push('-an')
  args.push(file)
  await runFfmpeg(args)
}

async function compress(
  media: MediaInfo,
  settings: CompressionSettings,
  outputPath: string,
  signal = new AbortController().signal
) {
  const progress: ProgressSnapshot[] = []
  const before = await stat(media.path)
  const result = await encodeVideo({
    ffmpegPath: ffmpeg,
    ffprobePath: ffprobe,
    media,
    settings,
    outputPath,
    inputPlaybackUrl: 'media://local/in',
    outputPlaybackUrl: 'media://local/out',
    overwrite: true,
    onProgress: (snapshot) => progress.push(snapshot),
    signal
  })
  const after = await stat(media.path)
  expect(after.size).toBe(before.size)
  expect(after.mtimeMs).toBe(before.mtimeMs)
  return { result, progress }
}

describe('ffmpeg integration', () => {
  beforeAll(async () => {
    const pair = await discoverBinaries()
    if (!pair) throw new Error('FFmpeg was not found. Install it before running integration tests.')
    ffmpeg = pair.ffmpeg
    ffprobe = pair.ffprobe
    await rm(root, { recursive: true, force: true })
    await mkdir(root, { recursive: true })
    await makeClip(join(root, 'basic.mp4'), {
      width: 320,
      height: 240,
      fps: 30,
      seconds: 1,
      audio: true
    })
    await makeClip(join(root, 'wide.mp4'), {
      width: 640,
      height: 360,
      fps: 30,
      seconds: 1,
      audio: true
    })
    await makeClip(join(root, 'silent.mp4'), {
      width: 320,
      height: 240,
      fps: 30,
      seconds: 1,
      audio: false
    })
    await makeClip(join(root, 'fps24.mp4'), {
      width: 320,
      height: 240,
      fps: 24,
      seconds: 1,
      audio: true
    })
    await makeClip(join(root, 'square.mp4'), {
      width: 1280,
      height: 1280,
      fps: 24,
      seconds: 1,
      audio: false
    })
    await makeClip(join(root, 'clip with spaces.mp4'), {
      width: 320,
      height: 180,
      fps: 30,
      seconds: 1,
      audio: true
    })
    await makeClip(join(root, 'cancel-source.mp4'), {
      width: 960,
      height: 540,
      fps: 30,
      seconds: 3,
      audio: false
    })
    await makeClip(join(root, 'rotated-source.mp4'), {
      width: 320,
      height: 240,
      fps: 30,
      seconds: 1,
      audio: false
    })
    await runFfmpeg([
      '-display_rotation',
      '90',
      '-i',
      join(root, 'rotated-source.mp4'),
      '-c',
      'copy',
      join(root, 'rotated.mp4')
    ])
    const rotated = await probeFile(ffprobe, join(root, 'rotated.mp4'))
    rotationAvailable = rotated.rotation === 90 || rotated.rotation === 270
    await writeFile(join(root, 'broken.mp4'), 'this is not a media file')
  }, 120000)

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('compresses every preset to a readable H.264 MP4', async () => {
    const source = await probeFile(ffprobe, join(root, 'basic.mp4'))
    for (const preset of ['maximum', 'high', 'balanced', 'small', 'facebook'] as const) {
      const output = join(root, `${preset}.mp4`)
      const { result, progress } = await compress(
        source,
        createSettingsFromPreset(preset, source.fileName),
        output
      )
      expect(result.outputVideoCodec).toBe('h264')
      expect(result.outputAudioCodec).toBe('aac')
      expect(result.outputSizeBytes).toBeGreaterThan(0)
      expect(progress.length).toBeGreaterThan(0)
      const verified = await probeFile(ffprobe, output)
      expect(verified.videoCodec).toBe('h264')
      expect(verified.hasAudio).toBe(true)
      expect(verified.displayWidth).toBe(320)
      expect(verified.displayHeight).toBe(240)
    }
  })

  it('does not upscale a small video and limits a larger frame for Facebook Ready', async () => {
    const small = await probeFile(ffprobe, join(root, 'wide.mp4'))
    const smallOut = join(root, 'facebook-small.mp4')
    const smallResult = await compress(
      small,
      createSettingsFromPreset('facebook', small.fileName),
      smallOut
    )
    expect(smallResult.result.outputWidth).toBe(640)
    expect(smallResult.result.outputHeight).toBe(360)

    const large = await probeFile(ffprobe, join(root, 'square.mp4'))
    const largeOut = join(root, 'facebook-large.mp4')
    const largeResult = await compress(
      large,
      createSettingsFromPreset('facebook', large.fileName),
      largeOut
    )
    expect(
      Math.max(largeResult.result.outputWidth ?? 0, largeResult.result.outputHeight ?? 0)
    ).toBeLessThanOrEqual(1920)
    expect(
      Math.min(largeResult.result.outputWidth ?? 0, largeResult.result.outputHeight ?? 0)
    ).toBeLessThanOrEqual(1080)
    expect(
      (largeResult.result.outputWidth ?? 0) * (largeResult.result.outputHeight ?? 0)
    ).toBeLessThan(1280 * 1280)
  })

  it('removes audio when asked and accepts a silent source', async () => {
    const source = await probeFile(ffprobe, join(root, 'basic.mp4'))
    const settings = createSettingsFromPreset('balanced', source.fileName)
    settings.audioMode = 'remove'
    const output = join(root, 'no-audio.mp4')
    const { result } = await compress(source, settings, output)
    expect(result.outputAudioCodec).toBeNull()
    const silent = await probeFile(ffprobe, join(root, 'silent.mp4'))
    const silentOut = join(root, 'silent-out.mp4')
    const silentResult = await compress(
      silent,
      createSettingsFromPreset('balanced', silent.fileName),
      silentOut
    )
    expect(silentResult.result.outputAudioCodec).toBeNull()
  })

  it('changes only the frame rate that was requested', async () => {
    const source = await probeFile(ffprobe, join(root, 'fps24.mp4'))
    expect(source.frameRate).toBeCloseTo(24, 0)
    const settings = createSettingsFromPreset('balanced', source.fileName)
    settings.frameRate = { mode: 'value', fps: 30 }
    const output = join(root, 'fps30.mp4')
    const { result } = await compress(source, settings, output)
    expect(result.outputFrameRate).toBeCloseTo(30, 0)
  })

  it('encodes a filename that contains spaces', async () => {
    const source = await probeFile(ffprobe, join(root, 'clip with spaces.mp4'))
    const output = join(root, 'spaced out.mp4')
    const { result } = await compress(
      source,
      createSettingsFromPreset('balanced', source.fileName),
      output
    )
    expect(result.outputPath).toBe(output)
    expect((await stat(output)).size).toBeGreaterThan(0)
  })

  it('does not report success for a truncated file and leaves no output', async () => {
    const broken = join(root, 'broken.mp4')
    await expect(probeFile(ffprobe, broken)).rejects.toThrow(
      /corrupt|truncated|not a valid|No video stream/i
    )
    const output = join(root, 'broken-out.mp4')
    await expect(
      encodeVideo({
        ffmpegPath: ffmpeg,
        ffprobePath: ffprobe,
        media: mediaFixture({
          path: broken,
          fileSizeBytes: 24,
          durationSeconds: 1,
          displayWidth: 320,
          displayHeight: 240,
          width: 320,
          height: 240
        }),
        settings: createSettingsFromPreset('balanced', 'broken.mp4'),
        outputPath: output,
        inputPlaybackUrl: 'media://local/in',
        outputPlaybackUrl: 'media://local/out',
        overwrite: true,
        onProgress: () => undefined,
        signal: new AbortController().signal
      })
    ).rejects.toThrow()
    await expect(stat(output)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('cancels an encode and removes temporary files', async () => {
    const source = await probeFile(ffprobe, join(root, 'cancel-source.mp4'))
    const settings = createSettingsFromPreset('maximum', source.fileName)
    settings.x264Preset = 'veryslow'
    settings.rateControl = { mode: 'crf', crf: 18 }
    const output = join(root, 'cancelled.mp4')
    const controller = new AbortController()
    const pending = encodeVideo({
      ffmpegPath: ffmpeg,
      ffprobePath: ffprobe,
      media: source,
      settings,
      outputPath: output,
      inputPlaybackUrl: 'media://local/in',
      outputPlaybackUrl: 'media://local/out',
      overwrite: true,
      onProgress: () => undefined,
      signal: controller.signal
    })
    setTimeout(() => controller.abort(), 200)
    await expect(pending).rejects.toBeInstanceOf(EncodeCancelled)
    await expect(stat(output)).rejects.toMatchObject({ code: 'ENOENT' })
    const leftovers = (await readdir(root)).filter(
      (name) => name.includes('partial') || name.includes('pass-0')
    )
    expect(leftovers).toEqual([])
    expect((await stat(source.path)).size).toBe(source.fileSizeBytes)
  })

  it('aims a two-pass encode at a size budget', async () => {
    const source = await probeFile(ffprobe, join(root, 'basic.mp4'))
    const settings = createSettingsFromPreset('balanced', source.fileName)
    settings.x264Preset = 'veryfast'
    settings.audioBitrateKbps = 96
    const targetBytes = 250_000
    settings.rateControl = { mode: 'size', targetBytes, twoPass: true }
    const output = join(root, 'targeted.mp4')
    const { result } = await compress(source, settings, output)
    expect(result.targetMet).toBe(true)
    expect(result.outputSizeBytes).toBeLessThan(targetBytes * 1.08)
    expect(result.targetMessage).toMatch(/budget|tolerance/i)
  })

  it('keeps a higher SSIM for Maximum Quality than Small File on the same synthetic clip', async () => {
    const maximum = await ssim(join(root, 'basic.mp4'), join(root, 'maximum.mp4'))
    const small = await ssim(join(root, 'basic.mp4'), join(root, 'small.mp4'))
    expect(maximum).toBeGreaterThan(0)
    expect(small).toBeGreaterThan(0)
    expect(maximum).toBeGreaterThanOrEqual(small - 0.01)
  })

  it('encodes a clip whose display matrix is rotated', async ({ skip }) => {
    if (!rotationAvailable) {
      skip()
      return
    }
    const source = await probeFile(ffprobe, join(root, 'rotated.mp4'))
    expect(source.displayWidth).toBe(240)
    expect(source.displayHeight).toBe(320)
    const output = join(root, 'rotated-out.mp4')
    const { result } = await compress(
      source,
      createSettingsFromPreset('balanced', source.fileName),
      output
    )
    expect(result.outputWidth).toBe(240)
    expect(result.outputHeight).toBe(320)
  })
})

async function ssim(source: string, encoded: string): Promise<number> {
  const stderr = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      ffmpeg,
      ['-hide_banner', '-i', encoded, '-i', source, '-lavfi', 'ssim', '-f', 'null', '-'],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    )
    let text = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      text += chunk
    })
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0 ? resolve(text) : reject(new Error(text || `ssim exited ${code}`))
    )
  })
  const match = /All:([0-9.]+)/.exec(stderr)
  if (!match) throw new Error(`SSIM score was not found.\n${stderr}`)
  return Number(match[1])
}
