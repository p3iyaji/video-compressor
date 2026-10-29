import { spawn } from 'node:child_process'
import { mkdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverBinaries } from '../src/main/services/binaries'
import { freeBytes } from '../src/main/services/disk'
import { encodeVideo } from '../src/main/services/encoder'
import { probeFile } from '../src/main/services/ffprobe'
import { createSettingsFromPreset } from '../src/shared/presets'
import { formatBytes } from '../src/shared/units'

const root = join(process.cwd(), 'tmp', 'large-file')
const sourcePath = join(root, 'source-1_2gb.mp4')
const outputPath = join(root, 'compressed.mp4')
const reportPath = join(process.cwd(), 'docs', 'LARGE-FILE-REPORT.md')
const minimumBytes = 1_150_000_000

async function writeReport(markdown: string): Promise<void> {
  const { mkdir: makeDir, writeFile } = await import('node:fs/promises')
  await makeDir(join(process.cwd(), 'docs'), { recursive: true })
  await writeFile(reportPath, markdown)
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))
    )
  })
}

export async function runLargeFileTest(): Promise<'passed' | 'skipped'> {
  const free = await freeBytes(tmpdir())
  if (free != null && free < 4_000_000_000) {
    await writeReport(`# Large-file test

Status: **not run**.

Free space in the temp volume was ${formatBytes(free)}. This check needs about 4 GB free so it can create a source near 1.2 GB and a compressed copy.

Run it locally when space is available:

\`\`\`bash
npm run test:large
\`\`\`
`)
    console.error(`Not enough free space (${formatBytes(free)}).`)
    return 'skipped'
  }
  const binaries = await discoverBinaries()
  if (!binaries) throw new Error('FFmpeg was not found.')
  await rm(root, { recursive: true, force: true })
  await mkdir(root, { recursive: true })
  console.log('Generating a noisy 720p source near 1.2 GB...')
  await run(binaries.ffmpeg, [
    '-hide_banner',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=1280x720:rate=30,noise=alls=40:allf=t',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=48000',
    '-t',
    '90',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-b:v',
    '110M',
    '-maxrate',
    '110M',
    '-bufsize',
    '110M',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    sourcePath
  ])
  const sourceStat = await stat(sourcePath)
  if (sourceStat.size < minimumBytes) {
    const message = `Generated source is ${sourceStat.size} bytes, below 1.15 GB. The large-file test did not pass.`
    await writeReport(`# Large-file test\n\nStatus: **failed**.\n\n${message}\n`)
    throw new Error(message)
  }
  const media = await probeFile(binaries.ffprobe, sourcePath)
  const settings = createSettingsFromPreset('balanced', media.fileName)
  settings.x264Preset = 'veryfast'
  const samples: number[] = []
  const sampler = setInterval(() => {
    void sampleFfmpeg(samples)
  }, 1000)
  const started = Date.now()
  try {
    const result = await encodeVideo({
      ffmpegPath: binaries.ffmpeg,
      ffprobePath: binaries.ffprobe,
      media,
      settings,
      outputPath,
      inputPlaybackUrl: 'media://local/in',
      outputPlaybackUrl: 'media://local/out',
      overwrite: true,
      onProgress: () => undefined,
      signal: new AbortController().signal
    })
    clearInterval(sampler)
    const verified = await probeFile(binaries.ffprobe, outputPath)
    const peak = samples.length > 0 ? Math.max(...samples) : null
    await writeReport(`# Large-file test

Status: **passed** on ${new Date().toISOString()}.

| Item | Value |
| --- | --- |
| Source size | ${formatBytes(sourceStat.size)} (${sourceStat.size} bytes) |
| Source duration | ${media.durationSeconds} seconds |
| Source resolution | ${media.displayWidth}×${media.displayHeight} |
| Settings | Balanced CRF ${settings.rateControl.mode === 'crf' ? settings.rateControl.crf : 'n/a'}, x264 ${settings.x264Preset}, AAC ${settings.audioBitrateKbps} kbps |
| Output size | ${formatBytes(result.outputSizeBytes)} (${result.outputSizeBytes} bytes) |
| Space saved | ${result.savedPercent.toFixed(1)}% |
| Encode time | ${result.encodingDurationSeconds.toFixed(1)} seconds |
| Wall clock including report | ${((Date.now() - started) / 1000).toFixed(1)} seconds |
| Peak FFmpeg RSS | ${peak == null ? 'not sampled' : `${(peak / 1024).toFixed(1)} MB`} |
| FFprobe validation | video ${verified.videoCodec}, audio ${verified.audioCodec}, ${verified.displayWidth}×${verified.displayHeight} |
| Output path | \`${outputPath}\` |

The source was synthetic test video, generated locally. It was not a tiny file renamed to look large.

Objective visual metrics were not run on the full 90 second file. SSIM or PSNR on a short synthetic clip does not prove that a real camera recording is visually lossless. Compare the source and output in the app preview or a video player.

Peak memory is the largest sampled RSS of an \`ffmpeg\` process during the encode, which can miss a brief spike between samples.
`)
    console.log(`Large-file test passed. Output ${formatBytes(result.outputSizeBytes)}.`)
    return 'passed'
  } catch (error) {
    clearInterval(sampler)
    await writeReport(`# Large-file test

Status: **failed**.

${error instanceof Error ? error.message : String(error)}

Source size at failure: ${sourceStat.size} bytes.

Re-run with:

\`\`\`bash
npm run test:large
\`\`\`
`)
    throw error
  }
}

async function sampleFfmpeg(samples: number[]): Promise<void> {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const exec = promisify(execFile)
  try {
    const { stdout } = await exec('ps', ['-axo', 'rss=,comm='])
    for (const line of stdout.split('\n')) {
      if (!line.includes('ffmpeg')) continue
      const rss = Number(line.trim().split(/\s+/)[0])
      if (Number.isFinite(rss)) samples.push(rss)
    }
  } catch {
    /* sampling is best effort */
  }
}
