import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { buildEstimate } from '../../shared/estimate'
import { defaultOutputFileName, sanitizeFileName } from '../../shared/filenames'
import { createSettingsFromPreset } from '../../shared/presets'
import type {
  AuthorizedMedia,
  CompressionSettings,
  DiskAssessment,
  EncoderAvailability,
  JobSnapshot,
  PresetId
} from '../../shared/types'
import { targetSizeToBytes, type SizeUnit } from '../../shared/units'

export function useCompressor() {
  const encoders = ref<EncoderAvailability | null>(null)
  const source = ref<AuthorizedMedia | null>(null)
  const outputDirectory = ref('')
  const settings = ref<CompressionSettings>(createSettingsFromPreset('balanced', 'video.mp4'))
  const filenameTouched = ref(false)
  const jobs = ref<JobSnapshot[]>([])
  const focusedJobId = ref<string | null>(null)
  const banner = ref<{ tone: 'info' | 'warning' | 'danger'; message: string } | null>(null)
  const disk = ref<DiskAssessment | null>(null)
  const modal = ref<null | {
    kind: 'overwrite' | 'aggressive'
    message: string
    outputPath?: string
  }>(null)
  const compare = ref(false)
  const dismissed = ref(new Set<string>())
  let stopEvents: (() => void) | null = null

  const estimate = computed(() =>
    source.value ? buildEstimate(source.value.info, settings.value) : null
  )
  const runningJob = computed(
    () => jobs.value.find((job) => job.status === 'running' || job.status === 'verifying') ?? null
  )
  const focusedJob = computed(
    () =>
      jobs.value.find((job) => job.id === focusedJobId.value) ??
      runningJob.value ??
      jobs.value[0] ??
      null
  )

  async function refreshDisk(): Promise<void> {
    if (!source.value || !outputDirectory.value || !window.compressor) return
    disk.value = await window.compressor.checkDisk(
      outputDirectory.value,
      estimate.value?.estimatedBytes ?? null,
      source.value.info.fileSizeBytes
    )
  }

  function adopt(media: AuthorizedMedia, resetName = true): void {
    source.value = media
    outputDirectory.value = media.outputDirectory
    compare.value = false
    banner.value = null
    if (resetName || !filenameTouched.value) {
      filenameTouched.value = false
      settings.value = {
        ...settings.value,
        outputFileName: defaultOutputFileName(media.info.fileName, settings.value.presetId)
      }
    }
  }

  async function browse(): Promise<void> {
    const files = await window.compressor.selectInput()
    if (files.length === 0) return
    adopt(files[0])
    if (files.length > 1) {
      let queued = 0
      for (const extra of files.slice(1)) {
        const started = await enqueue(extra, settingsFor(extra), false, false)
        if (started) queued += 1
      }
      banner.value = {
        tone: 'info',
        message: `The first video is ready to edit. ${queued} more ${queued === 1 ? 'was' : 'were'} added to the queue with the current settings.`
      }
    }
  }

  async function onDrop(files: File[]): Promise<void> {
    const videos = files.filter((file) => file.name.toLowerCase().endsWith('.mp4'))
    if (videos.length === 0) {
      banner.value = {
        tone: 'danger',
        message: 'Drop an MP4 file. Other formats are not accepted.'
      }
      return
    }
    try {
      const first = await window.compressor.authorizeDropped(
        window.compressor.pathForFile(videos[0])
      )
      adopt(first)
      let queued = 0
      for (const extra of videos.slice(1)) {
        const authorized = await window.compressor.authorizeDropped(
          window.compressor.pathForFile(extra)
        )
        const started = await enqueue(authorized, settingsFor(authorized), false, false)
        if (started) queued += 1
      }
      if (queued > 0) {
        banner.value = {
          tone: 'info',
          message: `${queued} additional ${queued === 1 ? 'video was' : 'videos were'} queued with the current settings.`
        }
      }
    } catch (error) {
      banner.value = {
        tone: 'danger',
        message: error instanceof Error ? error.message : 'That file could not be opened.'
      }
    }
  }

  function applyPreset(presetId: Exclude<PresetId, 'custom'>): void {
    const name = source.value?.info.fileName ?? 'video.mp4'
    const next = createSettingsFromPreset(presetId, name)
    next.encoder = settings.value.encoder
    if (filenameTouched.value) next.outputFileName = settings.value.outputFileName
    settings.value = next
  }

  function patchSettings(patch: Partial<CompressionSettings>): void {
    settings.value = {
      ...settings.value,
      ...patch,
      presetId: 'custom',
      acknowledgeAggressiveTarget: patch.acknowledgeAggressiveTarget ?? false
    }
  }

  function setTargetBytes(bytes: number): void {
    settings.value = {
      ...settings.value,
      rateControl: { mode: 'size', targetBytes: bytes, twoPass: true },
      acknowledgeAggressiveTarget: false
    }
  }

  function setCustomTarget(value: number, unit: SizeUnit): void {
    try {
      setTargetBytes(targetSizeToBytes(value, unit))
    } catch (error) {
      banner.value = {
        tone: 'danger',
        message: error instanceof Error ? error.message : 'Enter a valid target size.'
      }
    }
  }

  function useQualityMode(): void {
    const crf = settings.value.rateControl.mode === 'crf' ? settings.value.rateControl.crf : 23
    patchSettings({ rateControl: { mode: 'crf', crf } })
  }

  async function chooseOutputDirectory(): Promise<void> {
    const directory = await window.compressor.selectOutputDirectory()
    if (!directory) return
    outputDirectory.value = directory
  }

  async function enqueue(
    media: AuthorizedMedia,
    nextSettings: CompressionSettings,
    overwrite: boolean,
    acknowledge: boolean
  ): Promise<boolean> {
    const prepared: CompressionSettings = {
      ...nextSettings,
      outputFileName: sanitizeFileName(nextSettings.outputFileName),
      acknowledgeAggressiveTarget: acknowledge || nextSettings.acknowledgeAggressiveTarget
    }
    const result = await window.compressor.startJob(
      JSON.parse(
        JSON.stringify({
          inputPath: media.info.path,
          outputDirectory:
            media.info.path === source.value?.info.path
              ? outputDirectory.value
              : media.outputDirectory,
          settings: prepared,
          overwrite
        })
      )
    )
    if (result.ok) {
      upsert(result.job)
      focusedJobId.value = result.job.id
      banner.value = null
      modal.value = null
      return true
    }
    if (result.code === 'AGGRESSIVE_TARGET') {
      modal.value = { kind: 'aggressive', message: result.error }
      return false
    }
    if (result.code === 'OVERWRITE_REQUIRED') {
      modal.value = { kind: 'overwrite', message: result.error, outputPath: result.outputPath }
      return false
    }
    banner.value = { tone: 'danger', message: result.error }
    return false
  }

  async function compress(): Promise<void> {
    if (!source.value) return
    try {
      await enqueue(source.value, settings.value, false, settings.value.acknowledgeAggressiveTarget)
    } catch (error) {
      banner.value = {
        tone: 'danger',
        message: error instanceof Error ? error.message : 'Compression could not be started.'
      }
    }
  }

  async function confirmModal(): Promise<void> {
    if (!source.value || !modal.value) return
    const kind = modal.value.kind
    modal.value = null
    if (kind === 'aggressive') {
      settings.value = { ...settings.value, acknowledgeAggressiveTarget: true }
      await enqueue(source.value, settings.value, false, true)
      return
    }
    await enqueue(source.value, settings.value, true, settings.value.acknowledgeAggressiveTarget)
  }

  async function cancel(id: string): Promise<void> {
    jobs.value = await window.compressor.cancelJob(id)
  }

  async function retry(id: string): Promise<void> {
    const result = await window.compressor.retryJob(id)
    if (!result.ok) {
      banner.value = { tone: 'danger', message: result.error }
      return
    }
    upsert(result.job)
    focusedJobId.value = result.job.id
  }

  async function reveal(path: string): Promise<void> {
    await window.compressor.reveal(path)
  }

  async function play(path: string): Promise<void> {
    await window.compressor.openPath(path)
  }

  async function saveCopy(path: string): Promise<void> {
    const saved = await window.compressor.saveCopy(path)
    if (saved) banner.value = { tone: 'info', message: `Saved a copy to ${saved}.` }
  }

  async function locateFfmpeg(): Promise<void> {
    try {
      encoders.value = await window.compressor.locateFfmpeg()
      banner.value = encoders.value.error
        ? { tone: 'warning', message: encoders.value.error }
        : { tone: 'info', message: 'FFmpeg is ready.' }
    } catch (error) {
      banner.value = {
        tone: 'danger',
        message: error instanceof Error ? error.message : 'FFmpeg could not be checked.'
      }
    }
  }

  function compressAnother(): void {
    source.value = null
    compare.value = false
    banner.value = null
    focusedJobId.value = null
  }

  function dismissBanner(): void {
    if (focusedJob.value?.error) dismissed.value = new Set(dismissed.value).add(focusedJob.value.id)
    banner.value = null
  }

  function settingsFor(media: AuthorizedMedia): CompressionSettings {
    return {
      ...settings.value,
      outputFileName: defaultOutputFileName(media.info.fileName, settings.value.presetId)
    }
  }

  async function clearFinished(): Promise<void> {
    jobs.value = await window.compressor.clearFinished()
  }

  function upsert(job: JobSnapshot): void {
    const index = jobs.value.findIndex((entry) => entry.id === job.id)
    if (index === -1) jobs.value.unshift(job)
    else jobs.value.splice(index, 1, job)
  }

  watch([outputDirectory, estimate], () => {
    void refreshDisk()
  })

  onMounted(async () => {
    if (!window.compressor) return
    encoders.value = await window.compressor.getEncoders()
    jobs.value = await window.compressor.listJobs()
    stopEvents = window.compressor.onJobEvent((event) => {
      if (event.type === 'snapshot') jobs.value = event.jobs
      if (event.type === 'upsert') {
        upsert(event.job)
        if (
          event.job.status === 'completed' ||
          event.job.status === 'failed' ||
          event.job.status === 'cancelled'
        ) {
          focusedJobId.value = event.job.id
        }
      }
    })
  })

  onUnmounted(() => stopEvents?.())

  return {
    encoders,
    source,
    outputDirectory,
    settings,
    filenameTouched,
    jobs,
    focusedJob,
    runningJob,
    estimate,
    banner,
    disk,
    modal,
    compare,
    dismissed,
    browse,
    onDrop,
    applyPreset,
    patchSettings,
    setTargetBytes,
    setCustomTarget,
    useQualityMode,
    chooseOutputDirectory,
    compress,
    confirmModal,
    cancel,
    retry,
    reveal,
    play,
    saveCopy,
    locateFfmpeg,
    compressAnother,
    dismissBanner,
    clearFinished,
    focusJob: (id: string) => {
      focusedJobId.value = id
    }
  }
}
