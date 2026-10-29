import { defaultOutputFileName } from './filenames'
import type {
  AudioBitrateKbps,
  CompressionSettings,
  FrameRateChoice,
  PresetId,
  ResolutionChoice,
  X264Preset
} from './types'

export interface PresetDefinition {
  id: Exclude<PresetId, 'custom'>
  label: string
  description: string
  crf: number
  crfRange: [number, number]
  x264Preset: X264Preset
  resolution: ResolutionChoice
  audioBitrateKbps: AudioBitrateKbps
  frameRate: FrameRateChoice
  warning: string | null
}

export const PRESETS: Record<Exclude<PresetId, 'custom'>, PresetDefinition> = {
  maximum: {
    id: 'maximum',
    label: 'Maximum Quality',
    description:
      'H.264 at CRF 18 with a slower preset. Resolution and frame rate stay the same. This is still lossy compression, not a bit-for-bit copy.',
    crf: 18,
    crfRange: [18, 20],
    x264Preset: 'slow',
    resolution: { mode: 'original' },
    audioBitrateKbps: 192,
    frameRate: { mode: 'original' },
    warning: null
  },
  high: {
    id: 'high',
    label: 'High Quality',
    description:
      'H.264 at CRF 22. Keeps the original resolution and frame rate with a slower, more efficient preset.',
    crf: 22,
    crfRange: [21, 22],
    x264Preset: 'slow',
    resolution: { mode: 'original' },
    audioBitrateKbps: 160,
    frameRate: { mode: 'original' },
    warning: null
  },
  balanced: {
    id: 'balanced',
    label: 'Balanced',
    description:
      'The default. H.264 at CRF 23, suitable for general compression when you want a smaller file and a clean picture.',
    crf: 23,
    crfRange: [23, 24],
    x264Preset: 'medium',
    resolution: { mode: 'original' },
    audioBitrateKbps: 160,
    frameRate: { mode: 'original' },
    warning: null
  },
  small: {
    id: 'small',
    label: 'Small File',
    description:
      'H.264 at CRF 28. The file gets much smaller. Visible quality loss is more likely, especially in motion and dark scenes.',
    crf: 28,
    crfRange: [25, 28],
    x264Preset: 'medium',
    resolution: { mode: 'original' },
    audioBitrateKbps: 128,
    frameRate: { mode: 'original' },
    warning: 'Visible quality loss is more likely with the Small File preset.'
  },
  facebook: {
    id: 'facebook',
    label: 'Facebook Ready',
    description:
      'MP4 with H.264 video, AAC audio, yuv420p, and fast-start metadata. 1080p sources stay at 1080p. Taller or wider sources are limited to a 1080p frame and are never upscaled. Facebook limits still depend on the upload surface and account.',
    crf: 23,
    crfRange: [18, 28],
    x264Preset: 'medium',
    resolution: { mode: 'height', height: 1080 },
    audioBitrateKbps: 160,
    frameRate: { mode: 'original' },
    warning:
      'Facebook re-encodes many uploads, and size or length limits differ between Feed, Reels, Stories, and other tools. A compatible file is not a promise that every upload will be accepted.'
  }
}

export const PRESET_LIST = [
  PRESETS.maximum,
  PRESETS.high,
  PRESETS.balanced,
  PRESETS.small,
  PRESETS.facebook
]

const SLOW_PRESETS: X264Preset[] = ['slow', 'veryslow']

export function presetSpecIssues(preset: PresetDefinition): string[] {
  const issues: string[] = []
  const [min, max] = preset.crfRange
  if (preset.crf < min || preset.crf > max) {
    issues.push(`${preset.label} CRF ${preset.crf} is outside ${min}–${max}.`)
  }
  if (preset.id === 'maximum' && !SLOW_PRESETS.includes(preset.x264Preset)) {
    issues.push('Maximum Quality must use a slower x264 preset.')
  }
  if (preset.id === 'facebook') {
    if (preset.resolution.mode !== 'height' || preset.resolution.height !== 1080) {
      issues.push('Facebook Ready must default to a 1080p limit without upscaling.')
    }
  }
  if (
    (preset.id === 'maximum' ||
      preset.id === 'high' ||
      preset.id === 'balanced' ||
      preset.id === 'small') &&
    preset.resolution.mode !== 'original'
  ) {
    issues.push(`${preset.label} must preserve the source resolution by default.`)
  }
  if (preset.frameRate.mode !== 'original') {
    issues.push(`${preset.label} must preserve the source frame rate by default.`)
  }
  return issues
}

export function createSettingsFromPreset(
  presetId: Exclude<PresetId, 'custom'>,
  sourceFileName: string
): CompressionSettings {
  const preset = PRESETS[presetId]
  return {
    presetId,
    encoder: 'libx264',
    resolution: preset.resolution,
    rateControl: { mode: 'crf', crf: preset.crf },
    x264Preset: preset.x264Preset,
    audioMode: 'aac',
    audioBitrateKbps: preset.audioBitrateKbps,
    frameRate: preset.frameRate,
    fastStart: true,
    outputFileName: defaultOutputFileName(sourceFileName, presetId),
    acknowledgeAggressiveTarget: false
  }
}

export function presetLabel(presetId: PresetId): string {
  if (presetId === 'custom') return 'Custom'
  return PRESETS[presetId].label
}
