import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const destination = join(process.cwd(), 'tmp', 'sample.mp4')
await mkdir(join(process.cwd(), 'tmp'), { recursive: true })
const seconds = process.argv[2] ?? '5'

await new Promise<void>((resolve, reject) => {
  const child = spawn(
    'ffmpeg',
    [
      '-hide_banner',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=1280x720:rate=30',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000',
      '-t',
      seconds,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      destination
    ],
    { stdio: 'inherit' }
  )
  child.on('error', reject)
  child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))))
})

console.log(`Wrote ${destination}`)
