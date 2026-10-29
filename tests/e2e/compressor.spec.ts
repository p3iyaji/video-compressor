import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const projectRoot = process.cwd()
const electronPath = join(projectRoot, 'scripts', 'electron-playwright.mjs')
const fixtureDir = join(projectRoot, 'tmp', 'e2e')
const basicVideo = join(fixtureDir, 'basic e2e.mp4')
const cancelVideo = join(fixtureDir, 'cancel e2e.mp4')

async function ffmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      stdio: 'ignore'
    })
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))
    )
  })
}

function electronEnv(userData: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value
  }
  delete env.ELECTRON_RUN_AS_NODE
  env.SMART_MP4_E2E = '1'
  env.SMART_MP4_USER_DATA = userData
  env.ELECTRON_RENDERER_URL = ''
  return env
}

async function launch(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    executablePath: electronPath,
    args: [join(projectRoot, 'out', 'main', 'index.js')],
    env: electronEnv(userData)
  })
  const page = await app.firstWindow()
  await page.waitForSelector('text=Smart MP4 Compressor')
  return { app, page }
}

test.beforeAll(async () => {
  await rm(fixtureDir, { recursive: true, force: true })
  await mkdir(fixtureDir, { recursive: true })
  await ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=320x240:rate=30',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=44100',
    '-t',
    '1',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    basicVideo
  ])
  await ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=640x360:rate=30',
    '-t',
    '20',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-an',
    cancelVideo
  ])
})

test.afterAll(async () => {
  await rm(fixtureDir, { recursive: true, force: true })
})

test('a person can inspect, compress, compare, and reveal a video', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'smart-mp4-e2e-'))
  const revealLog = join(userData, 'revealed.txt')
  const { app, page } = await launch(userData)
  try {
    await app.evaluate(({ dialog }, videoPath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [videoPath] })
    }, basicVideo)
    await page.getByRole('button', { name: 'Browse MP4 files' }).click()
    await expect(page.getByText('320×240').first()).toBeVisible()
    await expect(page.getByText('h264').first()).toBeVisible()
    await page.getByRole('button', { name: /Balanced/ }).click()
    await page.getByRole('button', { name: 'Compress', exact: true }).click()
    await expect(page.getByText('Output verified')).toBeVisible({ timeout: 120000 })
    await page.getByRole('button', { name: 'Compare' }).click()
    await expect(page.locator('video')).toHaveCount(2)
    await app.evaluate(({ shell }, logPath) => {
      const fs = process.getBuiltinModule('fs')
      shell.showItemInFolder = (folderPath: string) => {
        fs.writeFileSync(logPath, folderPath)
      }
    }, revealLog)
    await page.getByRole('button', { name: 'Open folder' }).click()
    await expect
      .poll(async () => {
        const { readFile } = await import('node:fs/promises')
        return readFile(revealLog, 'utf8').catch(() => '')
      })
      .toContain('.mp4')
    await page.getByRole('button', { name: 'Compress another' }).click()
    await expect(page.getByRole('button', { name: 'Browse MP4 files' })).toBeVisible()
  } finally {
    await app.close()
    await rm(userData, { recursive: true, force: true })
  }
})

test('a person can cancel an encode', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'smart-mp4-e2e-cancel-'))
  const { app, page } = await launch(userData)
  try {
    await app.evaluate(({ dialog }, videoPath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [videoPath] })
    }, cancelVideo)
    await page.getByRole('button', { name: 'Browse MP4 files' }).click()
    await expect(page.getByText('640×360').first()).toBeVisible()
    await page.locator('select').filter({ hasText: 'veryslow' }).selectOption('veryslow')
    await page.getByRole('button', { name: 'Compress', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Compressing' })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).first().click()
    await expect(page.getByText(/cancelled/i).first()).toBeVisible({ timeout: 30000 })
  } finally {
    await app.close()
    await rm(userData, { recursive: true, force: true })
  }
})
