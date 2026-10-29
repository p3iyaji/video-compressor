import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { describeSettings } from '../../shared/estimate'
import { presetLabel } from '../../shared/presets'
import type {
  CompressionResult,
  CompressionSettings,
  JobEvent,
  JobSnapshot,
  JobStatus,
  MediaInfo,
  ProgressSnapshot
} from '../../shared/types'
import { EncodeCancelled } from './encoder'

const TERMINAL: JobStatus[] = ['completed', 'failed', 'cancelled', 'interrupted']

export interface EnqueueInput {
  media: MediaInfo
  outputPath: string
  outputDirectory: string
  inputPlaybackUrl: string
  outputPlaybackUrl: string
  settings: CompressionSettings
  overwrite: boolean
  retryOf?: string
}

export type EncodeWorker = (
  job: JobSnapshot,
  hooks: { signal: AbortSignal; onProgress: (progress: ProgressSnapshot) => void }
) => Promise<CompressionResult>

export class JobManager {
  private jobs: JobSnapshot[] = []
  private controllers = new Map<string, AbortController>()
  private running = 0
  private closed = false
  private persistChain: Promise<void> = Promise.resolve()

  constructor(
    private readonly storagePath: string,
    private readonly encode: EncodeWorker,
    private readonly notify: (event: JobEvent) => void,
    private readonly maxConcurrent = 1
  ) {}

  list(): JobSnapshot[] {
    return this.jobs.map((job) => ({ ...job }))
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.storagePath, 'utf8')
      const parsed = JSON.parse(raw) as JobSnapshot[]
      if (!Array.isArray(parsed)) throw new Error('Job history was not a list.')
      this.jobs = parsed.map((job) => {
        if (job.status === 'running' || job.status === 'verifying' || job.status === 'queued') {
          return {
            ...job,
            status: 'interrupted',
            error:
              'This encode was interrupted and needs to be started again. The original video was not modified.',
            finishedAt: new Date().toISOString()
          }
        }
        return job
      })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') this.jobs = []
    }
    await this.persist()
    this.notify({ type: 'snapshot', jobs: this.list() })
  }

  async enqueue(input: EnqueueInput): Promise<JobSnapshot> {
    if (this.closed) throw new Error('The app is shutting down.')
    const activeOutput = this.jobs.find(
      (job) => job.outputPath === input.outputPath && !TERMINAL.includes(job.status)
    )
    if (activeOutput) throw new Error('Another queued job is already writing that output file.')
    if (input.retryOf) {
      const previous = this.jobs.find((job) => job.id === input.retryOf)
      if (!previous) throw new Error('The original job could not be found for a retry.')
      const priorRetries = this.jobs.filter(
        (job) => job.retryOf === input.retryOf && job.status !== 'cancelled'
      )
      if (previous.retryCount >= 1 || priorRetries.length >= 1) {
        throw new Error(
          'Only one adjusted retry is offered. Change the settings manually for another attempt.'
        )
      }
    }
    const job: JobSnapshot = {
      id: randomUUID(),
      status: 'queued',
      inputPath: input.media.path,
      inputName: input.media.fileName,
      inputPlaybackUrl: input.inputPlaybackUrl,
      outputPlaybackUrl: input.outputPlaybackUrl,
      outputPath: input.outputPath,
      outputDirectory: input.outputDirectory,
      settings: input.settings,
      createdAt: new Date().toISOString(),
      warnings: [],
      retryOf: input.retryOf,
      retryCount: input.retryOf ? 1 : 0,
      sourceSizeBytes: input.media.fileSizeBytes,
      presetLabel: presetLabel(input.settings.presetId),
      settingsSummary: describeSettings(input.settings),
      overwrite: input.overwrite
    }
    this.jobs.unshift(job)
    this.trim()
    await this.persist()
    this.notify({ type: 'upsert', job: { ...job } })
    this.pump()
    return { ...job }
  }

  async cancel(id: string): Promise<void> {
    const job = this.jobs.find((entry) => entry.id === id)
    if (!job || TERMINAL.includes(job.status)) return
    if (job.status === 'queued') {
      this.update(job.id, {
        status: 'cancelled',
        error:
          'Removed from the queue before encoding started. The original video was not changed.',
        finishedAt: new Date().toISOString()
      })
      await this.persist()
      return
    }
    this.controllers.get(id)?.abort()
  }

  async clearFinished(): Promise<void> {
    this.jobs = this.jobs.filter((job) => !TERMINAL.includes(job.status))
    await this.persist()
    this.notify({ type: 'snapshot', jobs: this.list() })
  }

  shutdown(): void {
    this.closed = true
    for (const controller of this.controllers.values()) controller.abort()
  }

  private pump(): void {
    if (this.closed) return
    while (this.running < this.maxConcurrent) {
      const next = this.jobs.find((job) => job.status === 'queued')
      if (!next) return
      this.running += 1
      void this.run(next)
        .catch(() => undefined)
        .finally(() => {
          this.running -= 1
          this.pump()
        })
    }
  }

  private async run(job: JobSnapshot): Promise<void> {
    const controller = new AbortController()
    this.controllers.set(job.id, controller)
    this.update(job.id, {
      status: 'running',
      startedAt: new Date().toISOString(),
      error: undefined
    })
    await this.persist()
    try {
      const result = await this.encode(this.snapshot(job.id), {
        signal: controller.signal,
        onProgress: (progress) => {
          this.update(job.id, {
            progress,
            status: progress.stage === 'verifying' ? 'verifying' : 'running'
          })
          const current = this.snapshot(job.id)
          this.notify({ type: 'progress', jobId: job.id, progress })
          this.notify({ type: 'upsert', job: current })
        }
      })
      if (controller.signal.aborted) {
        this.markCancelled(job.id)
      } else {
        this.update(job.id, {
          status: 'completed',
          result,
          warnings: result.warnings,
          finishedAt: new Date().toISOString(),
          progress: {
            percent: 100,
            elapsedSeconds: result.encodingDurationSeconds,
            etaSeconds: 0,
            speed: null,
            fps: null,
            outputSizeBytes: result.outputSizeBytes,
            indeterminate: false,
            passIndex: 1,
            passCount: 1,
            stage: 'finished'
          }
        })
      }
    } catch (error) {
      if (error instanceof EncodeCancelled || controller.signal.aborted) this.markCancelled(job.id)
      else {
        this.update(job.id, {
          status: 'failed',
          error: error instanceof Error ? error.message : 'Encoding failed.',
          finishedAt: new Date().toISOString()
        })
      }
    } finally {
      this.controllers.delete(job.id)
      await this.persist()
      this.notify({ type: 'upsert', job: this.snapshot(job.id) })
    }
  }

  private markCancelled(id: string): void {
    this.update(id, {
      status: 'cancelled',
      error:
        'Compression was cancelled. Temporary files were removed and the original video was not changed.',
      finishedAt: new Date().toISOString()
    })
  }

  private update(id: string, patch: Partial<JobSnapshot>): void {
    const index = this.jobs.findIndex((job) => job.id === id)
    if (index === -1) return
    this.jobs[index] = { ...this.jobs[index], ...patch }
  }

  private snapshot(id: string): JobSnapshot {
    const job = this.jobs.find((entry) => entry.id === id)
    if (!job) throw new Error('Job disappeared before it could run.')
    return { ...job }
  }

  private trim(): void {
    const active = this.jobs.filter((job) => !TERMINAL.includes(job.status))
    const done = this.jobs.filter((job) => TERMINAL.includes(job.status)).slice(0, 40)
    this.jobs = [...active, ...done]
  }

  private async persist(): Promise<void> {
    const write = this.persistChain.then(() => this.writeJobs())
    this.persistChain = write.catch(() => undefined)
    await write
  }

  private async writeJobs(): Promise<void> {
    await mkdir(dirname(this.storagePath), { recursive: true })
    const temporary = `${this.storagePath}.${randomUUID()}.tmp`
    const payload = JSON.stringify(this.jobs)
    await writeFile(temporary, payload)
    await rename(temporary, this.storagePath)
  }
}
