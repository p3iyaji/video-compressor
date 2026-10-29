import type { EncoderAvailability, EncoderId } from './types'

const ENCODER_PATTERNS: Array<{ id: EncoderId; pattern: RegExp }> = [
  { id: 'libx264', pattern: /^\s*\S+\s+libx264\s+/m },
  { id: 'h264_videotoolbox', pattern: /^\s*\S+\s+h264_videotoolbox\s+/m },
  { id: 'h264_nvenc', pattern: /^\s*\S+\s+h264_nvenc\s+/m },
  { id: 'h264_qsv', pattern: /^\s*\S+\s+h264_qsv\s+/m }
]

export function parseEncoderList(ffmpegEncodersOutput: string): EncoderId[] {
  return ENCODER_PATTERNS.filter(({ pattern }) => pattern.test(ffmpegEncodersOutput)).map(
    ({ id }) => id
  )
}

export function hardwareQualityNote(encoder: EncoderId): string | null {
  if (encoder === 'libx264') return null
  const name =
    encoder === 'h264_videotoolbox'
      ? 'Apple VideoToolbox'
      : encoder === 'h264_nvenc'
        ? 'NVIDIA NVENC'
        : 'Intel Quick Sync'
  return `${name} can be faster than libx264, but the same-looking quality number does not produce the same picture or file size. Software encoding remains the predictable choice.`
}

export function emptyEncoderAvailability(error: string): EncoderAvailability {
  return {
    ffmpegPath: null,
    ffprobePath: null,
    source: 'unavailable',
    version: null,
    encoders: [],
    libx264: false,
    videotoolbox: false,
    nvenc: false,
    qsv: false,
    error
  }
}
