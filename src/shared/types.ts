export const PRESET_IDS = ['maximum', 'high', 'balanced', 'small', 'facebook', 'custom'] as const
export type PresetId = (typeof PRESET_IDS)[number]

export const X264_PRESETS = ['ultrafast', 'veryfast', 'fast', 'medium', 'slow', 'veryslow'] as const
export type X264Preset = (typeof X264_PRESETS)[number]

export const AUDIO_BITRATES = [96, 128, 160, 192, 256] as const
export type AudioBitrateKbps = (typeof AUDIO_BITRATES)[number]

export const AUDIO_MODES = ['aac', 'copy', 'remove'] as const
export type AudioMode = (typeof AUDIO_MODES)[number]

export const ENCODER_IDS = ['libx264', 'h264_videotoolbox', 'h264_nvenc', 'h264_qsv'] as const
export type EncoderId = (typeof ENCODER_IDS)[number]

export const STANDARD_HEIGHTS = [2160, 1440, 1080, 720] as const
export type StandardHeight = (typeof STANDARD_HEIGHTS)[number]

export type ResolutionChoice =
  | { mode: 'original' }
  | { mode: 'height'; height: StandardHeight }
  | { mode: 'custom'; width: number; height: number }

export type FrameRateChoice = { mode: 'original' } | { mode: 'value'; fps: number }

export interface SizeRateControl {
  mode: 'size'
  targetBytes: number
  twoPass: boolean
  videoBitrateOverrideBps?: number
}

export type RateControl = { mode: 'crf'; crf: number } | SizeRateControl

export interface CompressionSettings {
  presetId: PresetId
  encoder: EncoderId
  resolution: ResolutionChoice
  rateControl: RateControl
  x264Preset: X264Preset
  audioMode: AudioMode
  audioBitrateKbps: AudioBitrateKbps
  frameRate: FrameRateChoice
  fastStart: boolean
  outputFileName: string
  acknowledgeAggressiveTarget: boolean
}

export interface MediaInfo {
  path: string
  fileName: string
  fileSizeBytes: number
  durationSeconds: number | null
  width: number | null
  height: number | null
  displayWidth: number | null
  displayHeight: number | null
  frameRate: number | null
  videoCodec: string | null
  audioCodec: string | null
  videoBitrate: number | null
  audioBitrate: number | null
  overallBitrate: number | null
  pixelFormat: string | null
  rotation: number
  sampleAspectRatio: number
  hasAudio: boolean
  audioStreams: number
  videoStreams: number
  audioChannels: number | null
  isVfr: boolean
  formatName: string | null
  colorSpace: string | null
}

export interface AuthorizedMedia {
  info: MediaInfo
  playbackUrl: string
  outputDirectory: string
}

export type JobStatus =
  'queued' | 'running' | 'verifying' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

export interface ProgressSnapshot {
  percent: number | null
  elapsedSeconds: number
  etaSeconds: number | null
  speed: number | null
  fps: number | null
  outputSizeBytes: number | null
  indeterminate: boolean
  passIndex: number
  passCount: number
  stage: 'encoding' | 'verifying' | 'finished'
}

export interface CompressionResult {
  inputSizeBytes: number
  outputSizeBytes: number
  savedBytes: number
  savedPercent: number
  outputWidth: number | null
  outputHeight: number | null
  outputVideoCodec: string | null
  outputAudioCodec: string | null
  outputFrameRate: number | null
  encodingDurationSeconds: number
  outputBitrate: number | null
  targetBytes: number | null
  targetMet: boolean | null
  targetMessage: string | null
  outputPath: string
  outputPlaybackUrl: string
  inputPlaybackUrl: string
  warnings: string[]
  videoBitrateBps: number | null
}

export interface JobSnapshot {
  id: string
  status: JobStatus
  inputPath: string
  inputName: string
  inputPlaybackUrl: string
  outputPlaybackUrl: string
  outputPath: string
  outputDirectory: string
  settings: CompressionSettings
  createdAt: string
  startedAt?: string
  finishedAt?: string
  error?: string
  warnings: string[]
  progress?: ProgressSnapshot
  result?: CompressionResult
  retryOf?: string
  retryCount: number
  sourceSizeBytes: number
  presetLabel: string
  settingsSummary: string
  overwrite: boolean
}

export interface EncoderAvailability {
  ffmpegPath: string | null
  ffprobePath: string | null
  source: string
  version: string | null
  encoders: EncoderId[]
  libx264: boolean
  videotoolbox: boolean
  nvenc: boolean
  qsv: boolean
  error: string | null
}

export interface EstimateWarning {
  level: 'info' | 'warning' | 'danger'
  message: string
}

export interface QualityAlternative {
  title: string
  detail: string
  presetId: PresetId
}

export interface CompressionEstimate {
  label: string
  estimatedBytes: number | null
  confidence: 'rough' | 'budget' | 'unavailable'
  videoBitrateBps: number | null
  audioBitrateBps: number
  bitsPerPixel: number | null
  tooAggressive: boolean
  warnings: EstimateWarning[]
  alternative: QualityAlternative | null
  summary: PreExportSummary
}

export interface PreExportSummary {
  resolution: string
  frameRate: string
  videoCodec: string
  audioCodec: string
  quality: string
  fastStart: boolean
  estimatedSize: string
  tradeoffs: string[]
}

export interface DiskAssessment {
  freeBytes: number | null
  estimatedBytes: number | null
  ok: boolean
  warning: string | null
}

export interface ParsedProgress {
  outTimeSeconds: number | null
  speed: number | null
  fps: number | null
  totalSizeBytes: number | null
  finished: boolean
}

export type JobEvent =
  | { type: 'snapshot'; jobs: JobSnapshot[] }
  | { type: 'upsert'; job: JobSnapshot }
  | { type: 'progress'; jobId: string; progress: ProgressSnapshot }

export interface StartJobPayload {
  inputPath: string
  outputDirectory: string
  settings: CompressionSettings
  overwrite: boolean
  retryOf?: string
}

export interface AggressiveTargetError {
  code: 'AGGRESSIVE_TARGET'
  message: string
  alternative: QualityAlternative | null
}

export interface OverwriteRequired {
  code: 'OVERWRITE_REQUIRED'
  message: string
  outputPath: string
}

export type StartJobResult =
  | { ok: true; job: JobSnapshot }
  | {
      ok: false
      error: string
      code?: 'AGGRESSIVE_TARGET' | 'OVERWRITE_REQUIRED' | 'VALIDATION'
      outputPath?: string
      alternative?: QualityAlternative | null
    }
