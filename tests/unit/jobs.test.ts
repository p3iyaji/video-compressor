import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EncodeCancelled } from '../../src/main/services/encoder'
import { JobManager } from '../../src/main/services/jobs'
import type { JobEvent } from '../../src/shared/types'
import { balancedSettings, mediaFixture, resultFor } from '../helpers/fixtures'

const directories: string[] = []

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        await rm(directory, { recursive: true, force: true })
        break
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'ENOTEMPTY' || attempt === 7) throw error
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
    }
  }
})

async function manager(encode: ConstructorParameters<typeof JobManager>[1], maxConcurrent = 1) {
  const directory = await mkdtemp(join(tmpdir(), 'smart-mp4-jobs-'))
  directories.push(directory)
  const events: JobEvent[] = []
  const jobs = new JobManager(
    join(directory, 'jobs.json'),
    encode,
    (event) => events.push(event),
    maxConcurrent
  )
  return { jobs, events, directory }
}

describe('job queue', () => {
  it('encodes one video at a time and can cancel a running job', async () => {
    let active = 0
    let peak = 0
    const { jobs } = await manager(async (job, hooks) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          active -= 1
          resolve()
        }, 400)
        hooks.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer)
            active -= 1
            reject(new EncodeCancelled())
          },
          { once: true }
        )
      })
      return resultFor(job)
    })
    const media = mediaFixture()
    const first = await jobs.enqueue(input(media, '/videos/one.mp4'))
    const second = await jobs.enqueue(input(media, '/videos/two.mp4'))
    await jobs.cancel(first.id)
    await waitFor(() =>
      jobs.list().every((job) => job.status === 'completed' || job.status === 'cancelled')
    )
    expect(peak).toBe(1)
    expect(jobs.list().find((job) => job.id === first.id)?.status).toBe('cancelled')
    expect(jobs.list().find((job) => job.id === second.id)?.status).toBe('completed')
    expect(jobs.list().find((job) => job.id === first.id)?.error).toMatch(
      /original video was not changed/
    )
  })

  it('marks an in-progress job as interrupted after a restart', async () => {
    const { jobs, directory } = await manager(async (job, hooks) => {
      await new Promise<void>((resolve) => {
        hooks.signal.addEventListener('abort', () => resolve(), { once: true })
      })
      return resultFor(job)
    })
    await jobs.enqueue(input(mediaFixture(), '/videos/out.mp4'))
    await waitFor(() => jobs.list()[0]?.status === 'running')
    const reloaded = new JobManager(
      join(directory, 'jobs.json'),
      async () => {
        throw new Error('should not run')
      },
      () => undefined
    )
    await reloaded.load()
    expect(reloaded.list()[0]?.status).toBe('interrupted')
    expect(reloaded.list()[0]?.error).toMatch(/started again/)
    jobs.shutdown()
  })

  it('allows only one adjusted retry', async () => {
    const { jobs } = await manager(async (job) => resultFor(job))
    const original = await jobs.enqueue(input(mediaFixture(), '/videos/out.mp4'))
    await waitFor(() => jobs.list()[0]?.status === 'completed')
    await jobs.enqueue({ ...input(mediaFixture(), '/videos/out-2.mp4'), retryOf: original.id })
    await expect(
      jobs.enqueue({ ...input(mediaFixture(), '/videos/out-3.mp4'), retryOf: original.id })
    ).rejects.toThrow(/Only one adjusted retry/)
  })
})

function input(media: ReturnType<typeof mediaFixture>, outputPath: string) {
  return {
    media,
    outputPath,
    outputDirectory: '/videos',
    inputPlaybackUrl: 'media://local/in',
    outputPlaybackUrl: 'media://local/out',
    settings: balancedSettings(),
    overwrite: true
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > 5000) throw new Error('Timed out waiting for the job queue.')
    await new Promise((resolve) => setTimeout(resolve, 15))
  }
}
