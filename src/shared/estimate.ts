import { audioBudgetBitsPerSecond, calculateTargetBitrate, estimateCrfBytes } from './bitrate'
import { resolveOutputDimensions, resolutionLabel } from './dimensions'
import { hardwareQualityNote } from './encoders'
import { PRESETS, presetLabel } from './presets'
import { formatBitrate, formatBytes } from './units'
import type {
  CompressionEstimate,
  CompressionSettings,
  EncoderId,
  EstimateWarning,
  MediaInfo
} from './types'

export function buildEstimate(
  media: MediaInfo,
  settings: CompressionSettings
): CompressionEstimate {
  const width = media.displayWidth
  const height = media.displayHeight
  const dimensions =
    width && height ? resolveOutputDimensions(width, height, settings.resolution) : null
  const audioBits = audioBudgetBitsPerSecond({
    audioMode: settings.audioMode,
    selectedBitrateKbps: settings.audioBitrateKbps,
    sourceAudioBitrate: media.audioBitrate
  })
  const warnings: EstimateWarning[] = []
  const tradeoffs: string[] = [
    'Lossy H.264 compression cannot promise zero quality loss. CRF and bitrate change how much detail is kept.'
  ]
  if (dimensions?.warning) warnings.push({ level: 'info', message: dimensions.warning })
  if (settings.presetId === 'small') {
    warnings.push({
      level: 'warning',
      message: PRESETS.small.warning ?? 'Visible quality loss is more likely.'
    })
  }
  if (settings.presetId === 'facebook' && PRESETS.facebook.warning) {
    warnings.push({ level: 'info', message: PRESETS.facebook.warning })
  }
  const hardware = hardwareQualityNote(settings.encoder)
  if (hardware) warnings.push({ level: 'info', message: hardware })
  if (settings.audioMode !== 'remove' && !media.hasAudio) {
    warnings.push({
      level: 'info',
      message: 'This video has no audio stream. The output will not add one.'
    })
  }
  if (media.audioStreams > 1 && settings.audioMode !== 'remove') {
    warnings.push({
      level: 'info',
      message:
        'Only the first audio stream is kept, which is the compatible choice for social uploads.'
    })
  }
  if (media.videoStreams > 1) {
    warnings.push({ level: 'info', message: 'Only the first video stream is encoded.' })
  }
  if (settings.x264Preset === 'veryslow' || settings.x264Preset === 'slow') {
    tradeoffs.push(
      'Slower encoding spends more time to save space at the same CRF. It does not make the encode lossless.'
    )
  }

  let estimatedBytes: number | null = null
  let confidence: CompressionEstimate['confidence']
  let videoBitrateBps: number | null = null
  let bitsPerPixel: number | null = null
  let tooAggressive = false
  let alternative = null as CompressionEstimate['alternative']
  let quality: string
  let label: string

  if (settings.rateControl.mode === 'size') {
    const plan = calculateTargetBitrate({
      targetBytes: settings.rateControl.targetBytes,
      durationSeconds: media.durationSeconds,
      audioBitsPerSecond: settings.audioMode === 'remove' || !media.hasAudio ? 0 : audioBits,
      width: dimensions?.width ?? width,
      height: dimensions?.height ?? height,
      fps: settings.frameRate.mode === 'value' ? settings.frameRate.fps : media.frameRate,
      videoBitrateOverrideBps: settings.rateControl.videoBitrateOverrideBps
    })
    videoBitrateBps = plan.videoBitsPerSecond
    bitsPerPixel = plan.bitsPerPixel
    tooAggressive = plan.tooAggressive
    alternative = plan.alternative
    for (const message of plan.warnings) {
      warnings.push({
        level: plan.tooAggressive ? 'danger' : plan.poorQuality ? 'warning' : 'info',
        message
      })
    }
    if (!plan.ok) {
      label = 'Target is not practical'
      confidence = 'unavailable'
      quality = plan.error ?? 'Target rejected'
    } else {
      estimatedBytes = settings.rateControl.targetBytes
      confidence = 'budget'
      label = 'Size budget'
      quality = `${plan.videoBitrateKbps} kbps video${settings.rateControl.twoPass && settings.encoder === 'libx264' ? ', two-pass' : ', single pass'}`
      if (settings.rateControl.twoPass && settings.encoder !== 'libx264') {
        warnings.push({
          level: 'warning',
          message:
            'Two-pass targeting is used with libx264. The selected hardware encoder will use a single bitrate pass.'
        })
      }
    }
  } else {
    const crf = settings.rateControl.crf
    quality = `CRF ${crf}`
    if (crf < 18)
      tradeoffs.push('CRF below 18 creates very large files for a gain most people will not see.')
    if (crf > 28)
      warnings.push({ level: 'warning', message: 'CRF above 28 often shows visible quality loss.' })
    estimatedBytes = estimateCrfBytes({
      crf,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      fps: settings.frameRate.mode === 'value' ? settings.frameRate.fps : media.frameRate,
      durationSeconds: media.durationSeconds,
      audioBitsPerSecond: settings.audioMode === 'remove' || !media.hasAudio ? 0 : audioBits,
      preset: settings.encoder === 'libx264' ? settings.x264Preset : 'medium'
    })
    confidence = estimatedBytes == null ? 'unavailable' : 'rough'
    label = estimatedBytes == null ? 'Estimate unavailable' : 'Rough estimate'
    if (estimatedBytes == null) {
      warnings.push({
        level: 'info',
        message:
          'A size estimate needs duration, resolution, and frame rate. Encoding can still continue.'
      })
    } else {
      tradeoffs.push(
        'The size figure is a rough estimate. Real files vary with motion, grain, and scene complexity.'
      )
    }
  }

  const resolution = dimensions ? resolutionLabel(dimensions.width, dimensions.height) : 'Unknown'
  const frameRate =
    settings.frameRate.mode === 'original'
      ? media.frameRate
        ? `${trimNumber(media.frameRate)} fps`
        : 'Original'
      : `${trimNumber(settings.frameRate.fps)} fps`
  const audioCodec =
    settings.audioMode === 'remove'
      ? 'No audio'
      : settings.audioMode === 'copy'
        ? `Copy ${media.audioCodec ?? 'audio'} when compatible`
        : `AAC ${settings.audioBitrateKbps} kbps`

  return {
    label,
    estimatedBytes,
    confidence,
    videoBitrateBps,
    audioBitrateBps: settings.audioMode === 'remove' || !media.hasAudio ? 0 : audioBits,
    bitsPerPixel,
    tooAggressive,
    warnings: dedupeWarnings(warnings),
    alternative,
    summary: {
      resolution,
      frameRate,
      videoCodec: encoderLabel(settings.encoder),
      audioCodec,
      quality,
      fastStart: settings.fastStart,
      estimatedSize:
        estimatedBytes == null
          ? 'Unavailable'
          : confidence === 'budget'
            ? `${formatBytes(estimatedBytes)} budget`
            : `About ${formatBytes(estimatedBytes)}`,
      tradeoffs
    }
  }
}

function encoderLabel(encoder: EncoderId): string {
  if (encoder === 'libx264') return 'H.264 (libx264)'
  if (encoder === 'h264_videotoolbox') return 'H.264 (VideoToolbox)'
  if (encoder === 'h264_nvenc') return 'H.264 (NVENC)'
  return 'H.264 (Quick Sync)'
}

function trimNumber(value: number): string {
  const rounded = Math.round(value * 1000) / 1000
  return String(rounded)
}

function dedupeWarnings(warnings: EstimateWarning[]): EstimateWarning[] {
  const seen = new Set<string>()
  return warnings.filter((warning) => {
    if (seen.has(warning.message)) return false
    seen.add(warning.message)
    return true
  })
}

export function describeSettings(settings: CompressionSettings): string {
  const rate =
    settings.rateControl.mode === 'crf'
      ? `CRF ${settings.rateControl.crf}`
      : `${formatBytes(settings.rateControl.targetBytes)} budget`
  const audio =
    settings.audioMode === 'remove'
      ? 'no audio'
      : settings.audioMode === 'copy'
        ? 'copy audio'
        : `AAC ${settings.audioBitrateKbps} kbps`
  return `${presetLabel(settings.presetId)} · ${rate} · ${settings.x264Preset} · ${audio}`
}

export function assessDiskSpace(
  freeBytes: number | null,
  estimatedBytes: number | null,
  sourceBytes: number
): {
  ok: boolean
  warning: string | null
} {
  if (freeBytes == null) {
    return {
      ok: true,
      warning:
        'Free disk space could not be checked. Encoding still needs room for the output file.'
    }
  }
  const reserve = 256_000_000
  const needed = Math.max(estimatedBytes ?? sourceBytes, 50_000_000) + reserve
  if (freeBytes < needed) {
    return {
      ok: false,
      warning: `About ${formatBytes(freeBytes)} is free. This job may need ${formatBytes(needed)} including working space. Free space before encoding.`
    }
  }
  if (freeBytes < needed * 1.5) {
    return {
      ok: true,
      warning: `Disk space is getting tight (${formatBytes(freeBytes)} free). Keep an extra copy of the destination available.`
    }
  }
  return { ok: true, warning: null }
}

export function formatVideoBitrate(bitsPerSecond: number | null): string {
  return formatBitrate(bitsPerSecond)
}
