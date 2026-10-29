import { app, BrowserWindow, protocol, session } from 'electron'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { channels } from '../shared/ipc'
import type { EncoderAvailability, JobEvent } from '../shared/types'
import { MediaAllowlist } from './services/allowlist'
import type { BinaryPair } from './services/binaries'
import { encodeVideo } from './services/encoder'
import { probeFile } from './services/ffprobe'
import { JobManager } from './services/jobs'
import { loadEncoderAvailability, registerIpc } from './ipc'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true
    }
  }
])

const isE2E = process.env.SMART_MP4_E2E === '1'
if (isE2E) {
  app.setPath('userData', process.env.SMART_MP4_USER_DATA || join(tmpdir(), 'smart-mp4-e2e'))
}

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL)
let mainWindow: BrowserWindow | null = null
const allowlist = new MediaAllowlist()
let binaries: EncoderAvailability | null = null
let jobs: JobManager | null = null

interface StoredSettings {
  ffmpegPath?: string
  ffprobePath?: string
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

async function readSettings(): Promise<StoredSettings> {
  try {
    return JSON.parse(await readFile(settingsPath(), 'utf8')) as StoredSettings
  } catch {
    return {}
  }
}

async function writeSettings(settings: StoredSettings): Promise<void> {
  await mkdir(dirname(settingsPath()), { recursive: true })
  await writeFile(settingsPath(), JSON.stringify(settings))
}

function devCsp(): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' media: blob:",
    "connect-src 'self' media: ws://localhost:* http://localhost:* ws://127.0.0.1:* http://127.0.0.1:*",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'"
  ].join('; ')
}

function prodCsp(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "media-src 'self' media:",
    "connect-src 'self' media:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')
}

function preloadPath(): string {
  const directory = join(__dirname, '../preload')
  for (const name of ['index.cjs', 'index.js', 'index.mjs']) {
    const candidate = join(directory, name)
    if (existsSync(candidate)) return candidate
  }
  return join(directory, 'index.js')
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 880,
    minWidth: 980,
    minHeight: 720,
    show: false,
    backgroundColor: '#0c1116',
    title: 'Smart MP4 Compressor',
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devAllowed =
      isDev && (url.startsWith('http://localhost:') || url.startsWith('http://127.0.0.1:'))
    if (url.startsWith('file:') || devAllowed) return
    event.preventDefault()
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerMediaProtocol(): void {
  protocol.handle('media', async (request) => {
    let token: string
    try {
      const url = new URL(request.url)
      token = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
    } catch {
      return new Response('Bad request', { status: 400 })
    }
    const filePath = allowlist.resolveToken(token)
    if (!filePath) return new Response('Not found', { status: 404 })
    let size: number
    try {
      size = (await stat(filePath)).size
    } catch {
      return new Response('Not found', { status: 404 })
    }
    const range = request.headers.get('range')
    if (!range) {
      const stream = createReadStream(filePath)
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': String(size),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store'
        }
      })
    }
    const match = /bytes=(\d*)-(\d*)/.exec(range)
    if (!match) return new Response(null, { status: 416 })
    const start = match[1] ? Number(match[1]) : 0
    let end = match[2] ? Number(match[2]) : size - 1
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      start >= size ||
      end < start
    ) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}` }
      })
    }
    end = Math.min(end, size - 1)
    const stream = createReadStream(filePath, { start, end })
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store'
      }
    })
  })
}

async function boot(): Promise<void> {
  const stored = await readSettings()
  const loaded = await loadEncoderAvailability(
    stored.ffmpegPath && stored.ffprobePath
      ? { ffmpegPath: stored.ffmpegPath, ffprobePath: stored.ffprobePath }
      : undefined
  )
  binaries = loaded.availability
  const notify = (event: JobEvent) => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send(channels.jobEvent, event)
  }
  jobs = new JobManager(
    join(app.getPath('userData'), 'jobs.json'),
    async (job, hooks) => {
      if (!binaries?.ffmpegPath || !binaries.ffprobePath)
        throw new Error('FFmpeg is not available.')
      const media = await probeFile(binaries.ffprobePath, job.inputPath)
      return encodeVideo({
        ffmpegPath: binaries.ffmpegPath,
        ffprobePath: binaries.ffprobePath,
        media,
        settings: job.settings,
        outputPath: job.outputPath,
        inputPlaybackUrl: job.inputPlaybackUrl,
        outputPlaybackUrl: job.outputPlaybackUrl,
        overwrite: job.overwrite,
        onProgress: hooks.onProgress,
        signal: hooks.signal
      })
    },
    notify,
    1
  )
  await jobs.load()
  registerIpc({
    window: () => mainWindow,
    allowlist,
    jobs,
    binaries: () => binaries ?? loaded.availability,
    setBinaries: async (pair: BinaryPair | null, availability) => {
      binaries = availability
      if (pair) await writeSettings({ ffmpegPath: pair.ffmpeg, ffprobePath: pair.ffprobe })
    },
    isDev
  })
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false)
  })
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [isDev ? devCsp() : prodCsp()]
      }
    })
  })
  registerMediaProtocol()
  createWindow()
}

const gotLock = isE2E || app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  app
    .whenReady()
    .then(boot)
    .catch((error: unknown) => {
      console.error(error)
      app.quit()
    })
  app.on('window-all-closed', () => {
    jobs?.shutdown()
    app.quit()
  })
  app.on('before-quit', () => {
    jobs?.shutdown()
  })
}
