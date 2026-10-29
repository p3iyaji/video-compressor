import { dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { copyFile, stat } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { assessDiskSpace, buildEstimate } from '../shared/estimate'
import { buildEncodePlan } from '../shared/plan'
import { sanitizeFileName } from '../shared/filenames'
import { channels } from '../shared/ipc'
import { adjustBitrateForRetry } from '../shared/space'
import type {
  AuthorizedMedia,
  CompressionSettings,
  EncoderAvailability,
  StartJobPayload,
  StartJobResult
} from '../shared/types'
import { validateCompressionSettings } from '../shared/validation'
import {
  assertInputAllowed,
  assertOutputAllowed,
  checkOutputPair,
  platformOf,
  resolveDirectory,
  resolveExistingFile,
  type MediaAllowlist
} from './services/allowlist'
import { discoverBinaries, inspectBinaries, type BinaryPair } from './services/binaries'
import { freeBytes } from './services/disk'
import { probeFile } from './services/ffprobe'
import type { JobManager } from './services/jobs'

interface AppControls {
  window: () => BrowserWindow | null
  allowlist: MediaAllowlist
  jobs: JobManager
  binaries: () => EncoderAvailability
  setBinaries: (pair: BinaryPair | null, availability: EncoderAvailability) => Promise<void>
  isDev: boolean
}

function trusted(event: IpcMainInvokeEvent, isDev: boolean): void {
  const url = event.senderFrame?.url ?? ''
  if (isDev && (url.startsWith('http://localhost:') || url.startsWith('http://127.0.0.1:'))) return
  if (url.startsWith('file://')) return
  throw new Error('The request was rejected.')
}

async function authorizeFile(filePath: string, controls: AppControls): Promise<AuthorizedMedia> {
  const availability = controls.binaries()
  if (!availability.ffprobePath) throw new Error(availability.error ?? 'FFprobe is not available.')
  const real = await resolveExistingFile(filePath)
  const platform = platformOf(process.platform)
  assertInputAllowed(real, platform)
  let media
  try {
    media = await probeFile(availability.ffprobePath, real)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'This file could not be inspected.'
    if (/enoent|eacces|eperm|permission/i.test(message)) {
      throw new Error(
        'The file could not be read. Check that it still exists and that you can access it.',
        {
          cause: error
        }
      )
    }
    throw error instanceof Error ? error : new Error(message)
  }
  controls.allowlist.authorizeInput(real)
  return {
    info: { ...media, path: real },
    playbackUrl: controls.allowlist.playbackUrl(real),
    outputDirectory: dirname(real)
  }
}

function outputFrom(directory: string, fileName: string): string {
  const safe = sanitizeFileName(fileName)
  const outputPath = resolve(directory, safe)
  if (!outputPath.startsWith(`${directory}${sep}`) && outputPath !== `${directory}${sep}${safe}`) {
    throw new Error('The output file must stay inside the selected folder.')
  }
  return outputPath
}

async function prepareStart(
  payload: StartJobPayload,
  controls: AppControls
): Promise<StartJobResult> {
  const settingsCheck = validateCompressionSettings(payload.settings)
  if (!settingsCheck.ok)
    return { ok: false, code: 'VALIDATION', error: settingsCheck.errors[0] ?? 'Invalid settings.' }
  const availability = controls.binaries()
  if (!availability.ffmpegPath || !availability.ffprobePath) {
    return { ok: false, error: availability.error ?? 'FFmpeg is not available.' }
  }
  if (!availability.encoders.includes(payload.settings.encoder)) {
    return {
      ok: false,
      error:
        'The selected encoder is not available in this FFmpeg build. Software encoding with libx264 is the fallback.'
    }
  }
  const platform = platformOf(process.platform)
  const inputPath = await resolveExistingFile(payload.inputPath)
  if (!controls.allowlist.hasInput(inputPath)) {
    return { ok: false, error: 'Choose a video with Browse or by dropping it onto the window.' }
  }
  const outputDirectory = await resolveDirectory(payload.outputDirectory)
  if (!controls.allowlist.hasOutputDir(outputDirectory)) {
    return { ok: false, error: 'Choose a destination folder before compressing.' }
  }
  assertOutputAllowed(outputDirectory, platform)
  const outputPath = outputFrom(outputDirectory, payload.settings.outputFileName)
  checkOutputPair(inputPath, outputPath, platform)

  const media = await probeFile(availability.ffprobePath, inputPath)
  const estimate = buildEstimate(media, payload.settings)
  const encodePlan = buildEncodePlan(media, payload.settings)
  const confirm = encodePlan.errors.find((error) => error.startsWith('Confirm that you want'))
  if (confirm) {
    return {
      ok: false,
      code: 'AGGRESSIVE_TARGET',
      error: confirm,
      alternative: estimate.alternative
    }
  }
  const blocking = encodePlan.errors.find((error) => !error.startsWith('Confirm that you want'))
  if (blocking) return { ok: false, code: 'VALIDATION', error: blocking }
  let exists = false
  try {
    const info = await stat(outputPath)
    exists = info.isFile()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      return { ok: false, error: 'The destination could not be checked.' }
    }
  }
  if (exists && !payload.overwrite) {
    return {
      ok: false,
      code: 'OVERWRITE_REQUIRED',
      error:
        'That output file already exists. Confirm overwrite to replace it. The original video is never replaced.',
      outputPath
    }
  }
  const disk = assessDiskSpace(
    await freeBytes(outputDirectory),
    estimate.estimatedBytes,
    media.fileSizeBytes
  )
  if (!disk.ok) return { ok: false, error: disk.warning ?? 'There is not enough free disk space.' }

  const playbackInput = controls.allowlist.playbackUrl(inputPath)
  const playbackOutput = controls.allowlist.playbackUrl(outputPath)
  const job = await controls.jobs.enqueue({
    media: { ...media, path: inputPath },
    outputPath,
    outputDirectory,
    inputPlaybackUrl: playbackInput,
    outputPlaybackUrl: playbackOutput,
    settings: payload.settings,
    overwrite: payload.overwrite || exists,
    retryOf: payload.retryOf
  })
  return { ok: true, job }
}

function knownOutput(filePath: string, controls: AppControls): boolean {
  return controls.jobs
    .list()
    .some((job) => job.outputPath === filePath || job.inputPath === filePath)
}

export function registerIpc(controls: AppControls): void {
  const guard = (event: IpcMainInvokeEvent) => trusted(event, controls.isDev)

  ipcMain.handle(channels.selectInput, async (event) => {
    guard(event)
    const parent = controls.window()
    const result = parent
      ? await dialog.showOpenDialog(parent, {
          title: 'Choose MP4 videos',
          properties: ['openFile', 'multiSelections'],
          filters: [{ name: 'MP4 video', extensions: ['mp4'] }]
        })
      : await dialog.showOpenDialog({
          title: 'Choose MP4 videos',
          properties: ['openFile', 'multiSelections'],
          filters: [{ name: 'MP4 video', extensions: ['mp4'] }]
        })
    if (result.canceled) return []
    const authorized: AuthorizedMedia[] = []
    for (const filePath of result.filePaths) {
      authorized.push(await authorizeFile(filePath, controls))
    }
    return authorized
  })

  ipcMain.handle(channels.authorizeDropped, async (event, filePath: unknown) => {
    guard(event)
    if (typeof filePath !== 'string') throw new Error('Drop an MP4 file.')
    return authorizeFile(filePath, controls)
  })

  ipcMain.handle(channels.selectOutputDirectory, async (event) => {
    guard(event)
    const parent = controls.window()
    const result = parent
      ? await dialog.showOpenDialog(parent, {
          title: 'Choose an output folder',
          properties: ['openDirectory', 'createDirectory']
        })
      : await dialog.showOpenDialog({
          title: 'Choose an output folder',
          properties: ['openDirectory', 'createDirectory']
        })
    if (result.canceled || !result.filePaths[0]) return null
    const directory = await resolveDirectory(result.filePaths[0])
    assertOutputAllowed(directory, platformOf(process.platform))
    controls.allowlist.authorizeOutputDir(directory)
    return directory
  })

  ipcMain.handle(channels.getEncoders, async (event) => {
    guard(event)
    return controls.binaries()
  })

  ipcMain.handle(channels.locateFfmpeg, async (event) => {
    guard(event)
    const parent = controls.window()
    const result = parent
      ? await dialog.showOpenDialog(parent, {
          title: 'Locate the ffmpeg binary',
          properties: ['openFile']
        })
      : await dialog.showOpenDialog({ title: 'Locate the ffmpeg binary', properties: ['openFile'] })
    if (result.canceled || !result.filePaths[0]) return controls.binaries()
    const ffmpeg = await resolveExistingFile(result.filePaths[0])
    const sibling = resolve(
      dirname(ffmpeg),
      process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
    )
    let ffprobe = sibling
    try {
      await resolveExistingFile(sibling)
    } catch {
      const probePick = parent
        ? await dialog.showOpenDialog(parent, {
            title: 'Locate the ffprobe binary',
            properties: ['openFile']
          })
        : await dialog.showOpenDialog({
            title: 'Locate the ffprobe binary',
            properties: ['openFile']
          })
      if (probePick.canceled || !probePick.filePaths[0]) {
        throw new Error('FFprobe was not found next to the FFmpeg binary.')
      }
      ffprobe = await resolveExistingFile(probePick.filePaths[0])
    }
    const pair = { ffmpeg, ffprobe, source: 'settings' }
    const availability = await inspectBinaries(pair)
    if (!availability.libx264 && availability.encoders.length === 0) {
      throw new Error(availability.error ?? 'That binary does not look like a usable FFmpeg build.')
    }
    await controls.setBinaries(pair, availability)
    return availability
  })

  ipcMain.handle(
    channels.checkDisk,
    async (event, directory: unknown, estimatedBytes: unknown, sourceBytes: unknown) => {
      guard(event)
      if (typeof directory !== 'string') throw new Error('Choose a destination folder.')
      const real = await resolveDirectory(directory)
      if (!controls.allowlist.hasOutputDir(real))
        throw new Error('Choose a destination folder first.')
      const estimated = typeof estimatedBytes === 'number' ? estimatedBytes : null
      const source = typeof sourceBytes === 'number' && sourceBytes >= 0 ? sourceBytes : 0
      const free = await freeBytes(real)
      const assessment = assessDiskSpace(free, estimated, source)
      return { freeBytes: free, estimatedBytes: estimated, ...assessment }
    }
  )

  ipcMain.handle(channels.startJob, async (event, payload: unknown) => {
    guard(event)
    if (!isStartPayload(payload))
      return { ok: false, code: 'VALIDATION', error: 'The compression request was not valid.' }
    try {
      return await prepareStart(payload, controls)
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Could not start compression.'
      }
    }
  })

  ipcMain.handle(channels.retryJob, async (event, jobId: unknown) => {
    guard(event)
    if (typeof jobId !== 'string') return { ok: false, error: 'Choose a finished job to retry.' }
    const previous = controls.jobs.list().find((job) => job.id === jobId)
    if (
      !previous?.result ||
      previous.result.targetBytes == null ||
      previous.result.targetMet !== false
    ) {
      return {
        ok: false,
        error: 'An adjusted retry is only available when a size target was missed.'
      }
    }
    if (previous.retryCount >= 1 || previous.result.videoBitrateBps == null) {
      return {
        ok: false,
        error:
          'Change the settings manually for another attempt. Automatic retries stop after one adjustment.'
      }
    }
    const settings: CompressionSettings = {
      ...previous.settings,
      acknowledgeAggressiveTarget: true,
      rateControl: {
        mode: 'size',
        targetBytes: previous.result.targetBytes,
        twoPass: true,
        videoBitrateOverrideBps: adjustBitrateForRetry(
          previous.result.videoBitrateBps,
          previous.result.targetBytes,
          previous.result.outputSizeBytes
        )
      }
    }
    return prepareStart(
      {
        inputPath: previous.inputPath,
        outputDirectory: previous.outputDirectory,
        settings,
        overwrite: true,
        retryOf: previous.id
      },
      controls
    )
  })

  ipcMain.handle(channels.cancelJob, async (event, jobId: unknown) => {
    guard(event)
    if (typeof jobId !== 'string') throw new Error('Missing job.')
    await controls.jobs.cancel(jobId)
    return controls.jobs.list()
  })

  ipcMain.handle(channels.listJobs, async (event) => {
    guard(event)
    return controls.jobs.list()
  })

  ipcMain.handle(channels.clearFinished, async (event) => {
    guard(event)
    await controls.jobs.clearFinished()
    return controls.jobs.list()
  })

  ipcMain.handle(channels.reveal, async (event, filePath: unknown) => {
    guard(event)
    if (typeof filePath !== 'string' || !knownOutput(filePath, controls)) {
      throw new Error('Only files this app created or opened can be shown in the folder.')
    }
    shell.showItemInFolder(filePath)
    return true
  })

  ipcMain.handle(channels.openPath, async (event, filePath: unknown) => {
    guard(event)
    if (typeof filePath !== 'string' || !knownOutput(filePath, controls)) {
      throw new Error('Only videos opened or created here can be played.')
    }
    const error = await shell.openPath(filePath)
    if (error) throw new Error(error)
    return true
  })

  ipcMain.handle(channels.saveCopy, async (event, filePath: unknown) => {
    guard(event)
    if (typeof filePath !== 'string' || !knownOutput(filePath, controls)) {
      throw new Error('Only a compressed video from this app can be copied.')
    }
    const parent = controls.window()
    const result = parent
      ? await dialog.showSaveDialog(parent, {
          title: 'Save a copy',
          defaultPath: filePath,
          filters: [{ name: 'MP4 video', extensions: ['mp4'] }]
        })
      : await dialog.showSaveDialog({
          title: 'Save a copy',
          defaultPath: filePath,
          filters: [{ name: 'MP4 video', extensions: ['mp4'] }]
        })
    if (result.canceled || !result.filePath) return null
    const destination = result.filePath.toLowerCase().endsWith('.mp4')
      ? result.filePath
      : `${result.filePath}.mp4`
    if (resolve(destination) === resolve(filePath)) return filePath
    await copyFile(filePath, destination)
    return destination
  })
}

function isStartPayload(value: unknown): value is StartJobPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Partial<StartJobPayload>
  return (
    typeof payload.inputPath === 'string' &&
    typeof payload.outputDirectory === 'string' &&
    typeof payload.overwrite === 'boolean' &&
    !!payload.settings &&
    (payload.retryOf == null || typeof payload.retryOf === 'string')
  )
}

export async function loadEncoderAvailability(overrides?: {
  ffmpegPath?: string
  ffprobePath?: string
}): Promise<{ pair: BinaryPair | null; availability: EncoderAvailability }> {
  const pair = await discoverBinaries(overrides)
  const availability = await inspectBinaries(pair)
  return { pair, availability }
}
