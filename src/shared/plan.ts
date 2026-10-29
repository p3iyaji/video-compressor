import { calculateTargetBitrate, audioBudgetBitsPerSecond } from './bitrate'
import { resolveOutputDimensions } from './dimensions'
import type { EncodeOptions } from './ffmpeg-args'
import type { CompressionSettings, MediaInfo } from './types'

export interface EncodePlan {
  options: EncodeOptions
  warnings: string[]
  errors: string[]
  videoBitrateBps: number | null
  targetBytes: number | null
  outputWidth: number
  outputHeight: number
  maxLongSide: number
  maxShortSide: number
}

export function buildEncodePlan(media: MediaInfo, settings: CompressionSettings): EncodePlan {
  const warnings: string[] = []
  const errors: string[] = []
  if (media.displayWidth == null || media.displayHeight == null) {
    errors.push('The source resolution is missing, so encoding cannot start.')
  }
  const dimensions = resolveOutputDimensions(
    media.displayWidth ?? 2,
    media.displayHeight ?? 2,
    settings.resolution
  )
  if (dimensions.warning) warnings.push(dimensions.warning)

  let audioMode = settings.audioMode
  if (!media.hasAudio && audioMode !== 'remove') {
    audioMode = 'remove'
    warnings.push('The source has no audio, so the output will not contain an audio track.')
  } else if (audioMode === 'copy' && !canCopyAudio(media)) {
    audioMode = 'aac'
    warnings.push(
      'The source audio is not a compatible AAC stream, so it will be converted to AAC.'
    )
  }
  if (media.audioStreams > 1 && audioMode !== 'remove') {
    warnings.push('Extra audio streams are left out. The first audio stream is used.')
  }

  const audioBits = audioBudgetBitsPerSecond({
    audioMode,
    selectedBitrateKbps: settings.audioBitrateKbps,
    sourceAudioBitrate: media.audioBitrate
  })

  let crf: number | null = null
  let videoBitrateKbps: number | null = null
  let videoBitrateBps: number | null = null
  let targetBytes: number | null = null
  let twoPass = false

  if (settings.rateControl.mode === 'crf') {
    crf = settings.rateControl.crf
  } else {
    targetBytes = settings.rateControl.targetBytes
    const plan = calculateTargetBitrate({
      targetBytes,
      durationSeconds: media.durationSeconds,
      audioBitsPerSecond: audioMode === 'remove' ? 0 : audioBits,
      width: dimensions.width,
      height: dimensions.height,
      fps: settings.frameRate.mode === 'value' ? settings.frameRate.fps : media.frameRate,
      videoBitrateOverrideBps: settings.rateControl.videoBitrateOverrideBps
    })
    warnings.push(...plan.warnings)
    if (!plan.ok) errors.push(plan.error ?? 'The target size cannot be encoded.')
    videoBitrateBps = plan.videoBitsPerSecond
    videoBitrateKbps = plan.videoBitrateKbps
    twoPass = settings.rateControl.twoPass && settings.encoder === 'libx264'
    if (settings.rateControl.twoPass && settings.encoder !== 'libx264') {
      warnings.push(
        'Two-pass size targeting requires libx264. This hardware encoder will run a single bitrate pass.'
      )
    }
    if (plan.tooAggressive && !settings.acknowledgeAggressiveTarget && plan.ok) {
      errors.push(
        'Confirm that you want to compress at this very low target before encoding starts.'
      )
    }
  }

  const scale =
    dimensions.scaled ||
    dimensions.width !== media.displayWidth ||
    dimensions.height !== media.displayHeight

  const options: EncodeOptions = {
    encoder: settings.encoder,
    crf,
    videoBitrateKbps,
    twoPass,
    x264Preset: settings.x264Preset,
    width: dimensions.width,
    height: dimensions.height,
    scale,
    audioMode,
    audioBitrateKbps: settings.audioBitrateKbps,
    audioChannels: media.audioChannels,
    frameRate: settings.frameRate.mode === 'value' ? settings.frameRate.fps : null,
    fastStart: settings.fastStart,
    colorSpace: media.colorSpace
  }

  return {
    options,
    warnings: [...new Set(warnings)],
    errors,
    videoBitrateBps,
    targetBytes,
    outputWidth: dimensions.width,
    outputHeight: dimensions.height,
    maxLongSide: Math.max(dimensions.width, dimensions.height),
    maxShortSide: Math.min(dimensions.width, dimensions.height)
  }
}

function canCopyAudio(media: MediaInfo): boolean {
  if (!media.hasAudio || media.audioCodec !== 'aac') return false
  if (media.audioChannels != null && media.audioChannels > 2) return false
  return true
}
