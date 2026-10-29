import {
  AUDIO_BITRATES,
  AUDIO_MODES,
  ENCODER_IDS,
  PRESET_IDS,
  STANDARD_HEIGHTS,
  X264_PRESETS
} from './types'
import type { CompressionSettings, MediaInfo, ResolutionChoice } from './types'

export interface ValidationResult {
  ok: boolean
  errors: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isSupportedFrameRate(value: number): boolean {
  if (!Number.isFinite(value) || value < 1 || value > 120) return false
  return Math.abs(value * 1000 - Math.round(value * 1000)) < 0.001
}

export function validateCrf(crf: number): string | null {
  if (!Number.isInteger(crf) || crf < 0 || crf > 51)
    return 'CRF must be a whole number from 0 to 51.'
  return null
}

export function validateCompressionSettings(value: unknown): ValidationResult {
  const errors: string[] = []
  if (!isRecord(value)) return { ok: false, errors: ['Compression settings are missing.'] }
  const settings = value as Partial<CompressionSettings>
  if (!PRESET_IDS.includes(settings.presetId as CompressionSettings['presetId']))
    errors.push('Unknown preset.')
  if (!ENCODER_IDS.includes(settings.encoder as CompressionSettings['encoder']))
    errors.push('Unknown encoder.')
  if (!X264_PRESETS.includes(settings.x264Preset as CompressionSettings['x264Preset'])) {
    errors.push('Encoding speed must be ultrafast, veryfast, fast, medium, slow, or veryslow.')
  }
  if (!AUDIO_MODES.includes(settings.audioMode as CompressionSettings['audioMode']))
    errors.push('Unknown audio mode.')
  if (
    !AUDIO_BITRATES.includes(settings.audioBitrateKbps as CompressionSettings['audioBitrateKbps'])
  ) {
    errors.push('Audio bitrate must be 96, 128, 160, 192, or 256 kbps.')
  }
  if (typeof settings.fastStart !== 'boolean') errors.push('Fast start must be on or off.')
  if (
    typeof settings.outputFileName !== 'string' ||
    settings.outputFileName.length < 5 ||
    settings.outputFileName.length > 180
  ) {
    errors.push('Enter an output file name ending in .mp4.')
  } else if (!settings.outputFileName.toLowerCase().endsWith('.mp4')) {
    errors.push('The output file name must end in .mp4.')
  }
  if (typeof settings.acknowledgeAggressiveTarget !== 'boolean') {
    errors.push('Aggressive-target confirmation was not understood.')
  }
  errors.push(...validateResolution(settings.resolution))
  errors.push(...validateFrameRate(settings.frameRate))
  errors.push(...validateRateControl(settings.rateControl))
  return { ok: errors.length === 0, errors }
}

function validateResolution(value: unknown): string[] {
  if (!isRecord(value)) return ['Choose an output resolution.']
  if (value.mode === 'original') return []
  if (value.mode === 'height') {
    if (!STANDARD_HEIGHTS.includes(value.height as (typeof STANDARD_HEIGHTS)[number])) {
      return ['Resolution must be Original, 2160p, 1440p, 1080p, 720p, or custom.']
    }
    return []
  }
  if (value.mode === 'custom') {
    const width = value.width
    const height = value.height
    if (
      typeof width !== 'number' ||
      typeof height !== 'number' ||
      !Number.isFinite(width) ||
      !Number.isFinite(height)
    ) {
      return ['Custom width and height must be numbers.']
    }
    if (width < 16 || height < 16 || width > 7680 || height > 7680) {
      return ['Custom dimensions must be between 16 and 7680 pixels.']
    }
    return []
  }
  return ['Choose an output resolution.']
}

function validateFrameRate(value: unknown): string[] {
  if (!isRecord(value)) return ['Choose a frame rate.']
  if (value.mode === 'original') return []
  if (value.mode === 'value') {
    if (typeof value.fps !== 'number' || !isSupportedFrameRate(value.fps)) {
      return ['Custom frame rate must be between 1 and 120.']
    }
    return []
  }
  return ['Choose a frame rate.']
}

function validateRateControl(value: unknown): string[] {
  if (!isRecord(value)) return ['Choose CRF or a target file size.']
  if (value.mode === 'crf') {
    if (typeof value.crf !== 'number') return ['CRF is missing.']
    const error = validateCrf(value.crf)
    return error ? [error] : []
  }
  if (value.mode === 'size') {
    const errors: string[] = []
    if (
      typeof value.targetBytes !== 'number' ||
      !(value.targetBytes > 0) ||
      value.targetBytes > 2_000_000_000_000
    ) {
      errors.push('Enter a target size greater than zero.')
    }
    if (typeof value.twoPass !== 'boolean') errors.push('Choose whether two-pass encoding is on.')
    if (value.videoBitrateOverrideBps != null) {
      if (
        typeof value.videoBitrateOverrideBps !== 'number' ||
        value.videoBitrateOverrideBps < 100_000
      ) {
        errors.push('The retry bitrate is below the encoder minimum.')
      }
    }
    return errors
  }
  return ['Choose CRF or a target file size.']
}

export function resolutionFromSettings(settings: CompressionSettings): ResolutionChoice {
  return settings.resolution
}

export function settingsMatchMedia(settings: CompressionSettings, media: MediaInfo): string[] {
  const errors: string[] = []
  if (settings.audioMode !== 'remove' && !media.hasAudio && settings.audioMode === 'copy') {
    errors.push('This video has no audio to copy.')
  }
  if (
    (settings.resolution.mode === 'original' ||
      settings.resolution.mode === 'height' ||
      settings.resolution.mode === 'custom') &&
    (media.displayWidth == null || media.displayHeight == null)
  ) {
    errors.push('The source resolution is missing, so the output size cannot be chosen safely.')
  }
  return errors
}
