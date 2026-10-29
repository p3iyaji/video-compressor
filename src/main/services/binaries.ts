import { access, constants } from 'node:fs/promises'
import { join } from 'node:path'
import { parseEncoderList } from '../../shared/encoders'
import type { EncoderAvailability, EncoderId } from '../../shared/types'
import { runProcess } from './process-runner'

export interface BinaryPair {
  ffmpeg: string
  ffprobe: string
  source: string
}

async function canExecute(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function staticPath(packageName: string): Promise<string | null> {
  try {
    const loaded = (await import(packageName)) as { path?: string; default?: string } | string
    if (typeof loaded === 'string') return loaded
    if (loaded && typeof loaded.path === 'string') return loaded.path
    if (loaded && typeof loaded.default === 'string') return loaded.default
    return null
  } catch {
    return null
  }
}

async function which(command: string): Promise<string | null> {
  const finder = process.platform === 'win32' ? 'where' : 'which'
  try {
    const running = runProcess(finder, [command])
    let stdout = ''
    running.child.stdout?.setEncoding('utf8')
    running.child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
    })
    const result = await running.done
    if (result.code !== 0) return null
    const line = stdout
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .find(Boolean)
    return line ?? null
  } catch {
    return null
  }
}

function commonCandidates(): Array<{ ffmpeg: string; ffprobe: string; source: string }> {
  if (process.platform === 'win32') {
    const roots = [
      join(process.env.ProgramFiles ?? 'C:\\Program Files', 'ffmpeg', 'bin'),
      join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'ffmpeg', 'bin'),
      join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Links')
    ]
    return roots.map((root) => ({
      ffmpeg: join(root, 'ffmpeg.exe'),
      ffprobe: join(root, 'ffprobe.exe'),
      source: root
    }))
  }
  const directories = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']
  return directories.map((root) => ({
    ffmpeg: join(root, 'ffmpeg'),
    ffprobe: join(root, 'ffprobe'),
    source: root
  }))
}

export async function discoverBinaries(overrides?: {
  ffmpegPath?: string
  ffprobePath?: string
}): Promise<BinaryPair | null> {
  const candidates: BinaryPair[] = []
  if (overrides?.ffmpegPath && overrides.ffprobePath) {
    candidates.push({
      ffmpeg: overrides.ffmpegPath,
      ffprobe: overrides.ffprobePath,
      source: 'settings'
    })
  }
  if (process.env.FFMPEG_PATH && process.env.FFPROBE_PATH) {
    candidates.push({
      ffmpeg: process.env.FFMPEG_PATH,
      ffprobe: process.env.FFPROBE_PATH,
      source: 'environment'
    })
  }
  const fromPathFfmpeg = await which('ffmpeg')
  const fromPathProbe = await which('ffprobe')
  if (fromPathFfmpeg && fromPathProbe) {
    candidates.push({ ffmpeg: fromPathFfmpeg, ffprobe: fromPathProbe, source: 'PATH' })
  }
  candidates.push(...commonCandidates())
  const staticFfmpeg = await staticPath('ffmpeg-static')
  const staticProbe = await staticPath('ffprobe-static')
  if (staticFfmpeg && staticProbe) {
    candidates.push({ ffmpeg: staticFfmpeg, ffprobe: staticProbe, source: 'bundled' })
  }

  const seen = new Set<string>()
  for (const candidate of candidates) {
    const key = `${candidate.ffmpeg}|${candidate.ffprobe}`
    if (seen.has(key)) continue
    seen.add(key)
    if ((await canExecute(candidate.ffmpeg)) && (await canExecute(candidate.ffprobe)))
      return candidate
  }
  return null
}

export async function inspectBinaries(pair: BinaryPair | null): Promise<EncoderAvailability> {
  if (!pair) {
    return {
      ffmpegPath: null,
      ffprobePath: null,
      source: 'unavailable',
      version: null,
      encoders: [],
      libx264: false,
      videotoolbox: false,
      nvenc: false,
      qsv: false,
      error:
        'FFmpeg was not found. Install it locally and restart the app. Nothing is downloaded at encode time.'
    }
  }
  try {
    const versionRun = runProcess(pair.ffmpeg, ['-hide_banner', '-version'])
    let versionText = ''
    versionRun.child.stdout?.setEncoding('utf8')
    versionRun.child.stdout?.on('data', (chunk: string) => {
      versionText += chunk
    })
    const versionResult = await versionRun.done
    const encoderRun = runProcess(pair.ffmpeg, ['-hide_banner', '-encoders'])
    let encoderText = ''
    encoderRun.child.stdout?.setEncoding('utf8')
    encoderRun.child.stdout?.on('data', (chunk: string) => {
      encoderText += chunk
    })
    const encoderResult = await encoderRun.done
    if (versionResult.code !== 0 || encoderResult.code !== 0) {
      throw new Error('FFmpeg did not respond to -version or -encoders.')
    }
    const encoders = parseEncoderList(encoderText)
    const has = (id: EncoderId) => encoders.includes(id)
    return {
      ffmpegPath: pair.ffmpeg,
      ffprobePath: pair.ffprobe,
      source: pair.source,
      version: versionText.split(/\r?\n/)[0] ?? null,
      encoders,
      libx264: has('libx264'),
      videotoolbox: has('h264_videotoolbox'),
      nvenc: has('h264_nvenc'),
      qsv: has('h264_qsv'),
      error: has('libx264')
        ? null
        : 'This FFmpeg build does not include libx264. Install a build with libx264 for predictable H.264 compression.'
    }
  } catch (error) {
    return {
      ffmpegPath: pair.ffmpeg,
      ffprobePath: pair.ffprobe,
      source: pair.source,
      version: null,
      encoders: [],
      libx264: false,
      videotoolbox: false,
      nvenc: false,
      qsv: false,
      error: error instanceof Error ? error.message : 'FFmpeg could not be inspected.'
    }
  }
}
