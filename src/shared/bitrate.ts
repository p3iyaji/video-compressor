import type { QualityAlternative, X264Preset } from './types'

export const CONTAINER_OVERHEAD_RATIO = 0.02
export const MIN_VIDEO_BPS = 100_000
const POOR_BPP = 0.03
const AGGRESSIVE_BPP = 0.015

const CRF_BPP: Array<[number, number]> = [
  [18, 0.16],
  [20, 0.12],
  [22, 0.095],
  [23, 0.085],
  [24, 0.075],
  [26, 0.055],
  [28, 0.042],
  [32, 0.028],
  [36, 0.018],
  [51, 0.008]
]

export const PRESET_SIZE_FACTOR: Record<X264Preset, number> = {
  ultrafast: 1.28,
  veryfast: 1.12,
  fast: 1.05,
  medium: 1,
  slow: 0.94,
  veryslow: 0.88
}

export interface BitratePlan {
  ok: boolean
  error: string | null
  totalBitsPerSecond: number
  overheadBitsPerSecond: number
  audioBitsPerSecond: number
  videoBitsPerSecond: number
  videoBitrateKbps: number
  bitsPerPixel: number | null
  poorQuality: boolean
  tooAggressive: boolean
  alternative: QualityAlternative | null
  warnings: string[]
}

export function bitsPerPixel(
  videoBps: number,
  width: number,
  height: number,
  fps: number
): number | null {
  if (!(videoBps > 0) || !(width > 0) || !(height > 0) || !(fps > 0)) return null
  return videoBps / (width * height * fps)
}

export function qualityAlternative(): QualityAlternative {
  return {
    title: 'Use Balanced instead',
    detail:
      'CRF 23 keeps a watchable picture and lets the file be as large as the video needs. A tiny target size cannot invent detail that the bitrate does not have room to store.',
    presetId: 'balanced'
  }
}

export function calculateTargetBitrate(input: {
  targetBytes: number
  durationSeconds: number | null
  audioBitsPerSecond: number
  width: number | null
  height: number | null
  fps: number | null
  videoBitrateOverrideBps?: number
}): BitratePlan {
  const empty = (error: string): BitratePlan => ({
    ok: false,
    error,
    totalBitsPerSecond: 0,
    overheadBitsPerSecond: 0,
    audioBitsPerSecond: 0,
    videoBitsPerSecond: 0,
    videoBitrateKbps: 0,
    bitsPerPixel: null,
    poorQuality: false,
    tooAggressive: true,
    alternative: qualityAlternative(),
    warnings: [error]
  })

  if (!(input.targetBytes > 0)) return empty('Enter a target size greater than zero.')
  if (input.durationSeconds == null || !(input.durationSeconds > 0)) {
    return empty('This video has no usable duration, so a target file size cannot be calculated.')
  }

  const totalBitsPerSecond = (input.targetBytes * 8) / input.durationSeconds
  const overheadBitsPerSecond = totalBitsPerSecond * CONTAINER_OVERHEAD_RATIO
  const audioBitsPerSecond = Math.max(0, input.audioBitsPerSecond)
  const override = input.videoBitrateOverrideBps
  const videoBitsPerSecond =
    override != null && override > 0
      ? override
      : totalBitsPerSecond - overheadBitsPerSecond - audioBitsPerSecond
  const warnings: string[] = []
  const bpp = bitsPerPixel(videoBitsPerSecond, input.width ?? 0, input.height ?? 0, input.fps ?? 0)

  if (videoBitsPerSecond < MIN_VIDEO_BPS) {
    const error = `The target leaves about ${Math.max(0, Math.round(videoBitsPerSecond / 1000))} kbps for video after audio and container overhead. That is below the ${MIN_VIDEO_BPS / 1000} kbps minimum.`
    return {
      ok: false,
      error,
      totalBitsPerSecond,
      overheadBitsPerSecond,
      audioBitsPerSecond,
      videoBitsPerSecond,
      videoBitrateKbps: Math.floor(videoBitsPerSecond / 1000),
      bitsPerPixel: bpp,
      poorQuality: true,
      tooAggressive: true,
      alternative: qualityAlternative(),
      warnings: [error]
    }
  }

  let poorQuality = false
  let tooAggressive = false
  if (bpp != null && bpp < AGGRESSIVE_BPP) {
    poorQuality = true
    tooAggressive = true
    warnings.push(
      'This target is likely to look poor. The video bitrate is very low for the resolution and frame rate.'
    )
  } else if (bpp != null && bpp < POOR_BPP) {
    poorQuality = true
    warnings.push('This target is tight. Fine detail and motion may look soft or blocky.')
  }
  if (input.width == null || input.height == null || input.fps == null) {
    warnings.push(
      'Resolution or frame rate is missing, so the quality warning is based only on the minimum bitrate.'
    )
  }
  warnings.push(
    'Exact output size is not guaranteed. Two-pass encoding aims near this budget and can still vary.'
  )

  return {
    ok: true,
    error: null,
    totalBitsPerSecond,
    overheadBitsPerSecond,
    audioBitsPerSecond,
    videoBitsPerSecond,
    videoBitrateKbps: Math.max(1, Math.floor(videoBitsPerSecond / 1000)),
    bitsPerPixel: bpp,
    poorQuality,
    tooAggressive,
    alternative: tooAggressive ? qualityAlternative() : null,
    warnings
  }
}

export function interpolateCrfBpp(crf: number): number {
  const clamped = Math.min(51, Math.max(0, crf))
  if (clamped <= CRF_BPP[0][0]) return CRF_BPP[0][1]
  for (let index = 1; index < CRF_BPP.length; index += 1) {
    const [crf1, bpp1] = CRF_BPP[index]
    const [crf0, bpp0] = CRF_BPP[index - 1]
    if (clamped <= crf1) {
      const t = (clamped - crf0) / (crf1 - crf0)
      return bpp0 + (bpp1 - bpp0) * t
    }
  }
  return CRF_BPP[CRF_BPP.length - 1][1]
}

export function estimateCrfBytes(input: {
  crf: number
  width: number | null
  height: number | null
  fps: number | null
  durationSeconds: number | null
  audioBitsPerSecond: number
  preset: X264Preset
}): number | null {
  if (
    input.width == null ||
    input.height == null ||
    input.fps == null ||
    input.durationSeconds == null ||
    !(input.durationSeconds > 0)
  ) {
    return null
  }
  const videoBps =
    interpolateCrfBpp(input.crf) *
    input.width *
    input.height *
    input.fps *
    PRESET_SIZE_FACTOR[input.preset]
  const totalBps =
    (videoBps + Math.max(0, input.audioBitsPerSecond)) / (1 - CONTAINER_OVERHEAD_RATIO)
  return Math.round((totalBps * input.durationSeconds) / 8)
}

export function audioBudgetBitsPerSecond(input: {
  audioMode: 'aac' | 'copy' | 'remove'
  selectedBitrateKbps: number
  sourceAudioBitrate: number | null
}): number {
  if (input.audioMode === 'remove') return 0
  if (
    input.audioMode === 'copy' &&
    input.sourceAudioBitrate != null &&
    input.sourceAudioBitrate > 0
  ) {
    return input.sourceAudioBitrate
  }
  return input.selectedBitrateKbps * 1000
}
