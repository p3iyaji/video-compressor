import type { EncoderId, MediaInfo, X264Preset } from './types'

export interface EncodeOptions {
  encoder: EncoderId
  crf: number | null
  videoBitrateKbps: number | null
  twoPass: boolean
  x264Preset: X264Preset
  width: number
  height: number
  scale: boolean
  audioMode: 'aac' | 'copy' | 'remove'
  audioBitrateKbps: number
  audioChannels: number | null
  frameRate: number | null
  fastStart: boolean
  colorSpace: string | null
}

export interface FfmpegPass {
  label: 'single' | 'pass1' | 'pass2'
  args: string[]
}

const SAFE_COLOR_SPACES = new Set(['bt709', 'bt470bg', 'smpte170m', 'bt2020nc'])

export function crfToVideoToolboxQuality(crf: number): number {
  return Math.min(90, Math.max(20, Math.round(100 - crf * 1.7)))
}

export function buildFfmpegPasses(input: {
  inputPath: string
  tempOutputPath: string
  passLogPrefix: string
  nullDevice: string
  options: EncodeOptions
}): FfmpegPass[] {
  const { options } = input
  const useTwoPass =
    options.twoPass && options.encoder === 'libx264' && options.videoBitrateKbps != null
  if (useTwoPass) {
    return [
      {
        label: 'pass1',
        args: [
          ...inputArgs(input.inputPath),
          ...mapArgs(options, false),
          ...videoArgs(options, 1, input.passLogPrefix),
          ...rateArgs(options),
          '-an',
          '-f',
          'null',
          ...progressArgs(false),
          input.nullDevice
        ]
      },
      {
        label: 'pass2',
        args: [
          ...inputArgs(input.inputPath),
          ...mapArgs(options, true),
          ...videoArgs(options, 2, input.passLogPrefix),
          ...rateArgs(options),
          ...audioArgs(options),
          ...metadataArgs(options),
          ...progressArgs(options.fastStart),
          input.tempOutputPath
        ]
      }
    ]
  }
  return [
    {
      label: 'single',
      args: [
        ...inputArgs(input.inputPath),
        ...mapArgs(options, true),
        ...videoArgs(options, null, null),
        ...rateArgs(options),
        ...audioArgs(options),
        ...metadataArgs(options),
        ...progressArgs(options.fastStart),
        input.tempOutputPath
      ]
    }
  ]
}

function inputArgs(inputPath: string): string[] {
  return ['-hide_banner', '-loglevel', 'warning', '-y', '-i', inputPath]
}

function mapArgs(options: EncodeOptions, includeAudio: boolean): string[] {
  const args = ['-map', '0:v:0']
  if (includeAudio && options.audioMode !== 'remove') args.push('-map', '0:a:0')
  return args
}

function videoArgs(
  options: EncodeOptions,
  pass: 1 | 2 | null,
  passLogPrefix: string | null
): string[] {
  const args: string[] = []
  if (options.encoder === 'libx264') {
    args.push('-c:v', 'libx264', '-preset', options.x264Preset)
  } else if (options.encoder === 'h264_videotoolbox') {
    args.push('-c:v', 'h264_videotoolbox', '-profile:v', 'high')
  } else if (options.encoder === 'h264_nvenc') {
    args.push('-c:v', 'h264_nvenc', '-preset', 'p5', '-profile:v', 'high')
  } else {
    args.push('-c:v', 'h264_qsv', '-profile:v', 'high')
  }
  args.push('-pix_fmt', 'yuv420p')
  if (options.encoder === 'libx264') args.push('-profile:v', 'high')
  const longSide = Math.max(options.width, options.height)
  const shortSide = Math.min(options.width, options.height)
  const fps = options.frameRate ?? 30
  if (options.encoder === 'libx264' && longSide <= 1920 && shortSide <= 1080 && fps <= 60) {
    args.push('-level:v', '4.2')
  }
  if (pass != null && passLogPrefix) {
    args.push('-pass', String(pass), '-passlogfile', passLogPrefix)
  }
  const filters: string[] = []
  if (options.scale) {
    filters.push(
      `scale=${options.width}:${options.height}:force_original_aspect_ratio=decrease:force_divisible_by=2`
    )
  }
  if (filters.length > 0) args.push('-vf', filters.join(','))
  if (options.frameRate == null) args.push('-fps_mode', 'passthrough')
  else args.push('-fps_mode', 'cfr', '-r', trimFps(options.frameRate))
  return args
}

function rateArgs(options: EncodeOptions): string[] {
  if (options.videoBitrateKbps != null) {
    const bitrate = `${Math.max(1, Math.round(options.videoBitrateKbps))}k`
    if (options.encoder === 'libx264') return ['-b:v', bitrate]
    if (options.encoder === 'h264_nvenc')
      return ['-rc', 'vbr', '-b:v', bitrate, '-maxrate', bitrate]
    if (options.encoder === 'h264_qsv') return ['-b:v', bitrate]
    return ['-b:v', bitrate]
  }
  if (options.crf == null) return []
  if (options.encoder === 'libx264') return ['-crf', String(options.crf)]
  if (options.encoder === 'h264_videotoolbox')
    return ['-q:v', String(crfToVideoToolboxQuality(options.crf))]
  if (options.encoder === 'h264_nvenc')
    return ['-rc', 'vbr', '-cq', String(options.crf), '-b:v', '0']
  return ['-global_quality', String(options.crf)]
}

function audioArgs(options: EncodeOptions): string[] {
  if (options.audioMode === 'remove') return ['-an']
  if (options.audioMode === 'copy') return ['-c:a', 'copy']
  const args = ['-c:a', 'aac', '-b:a', `${options.audioBitrateKbps}k`]
  if (options.audioChannels != null && options.audioChannels > 2) args.push('-ac', '2')
  return args
}

function metadataArgs(options: EncodeOptions): string[] {
  const args = [
    '-map_metadata',
    '0',
    '-map_chapters',
    '0',
    '-avoid_negative_ts',
    'make_zero',
    '-max_muxing_queue_size',
    '1024'
  ]
  if (options.colorSpace && SAFE_COLOR_SPACES.has(options.colorSpace)) {
    args.push('-colorspace', options.colorSpace)
  }
  return args
}

function progressArgs(fastStart: boolean): string[] {
  const args = ['-progress', 'pipe:1', '-nostats']
  if (fastStart) args.push('-movflags', '+faststart')
  return args
}

function trimFps(fps: number): string {
  const rounded = Math.round(fps * 1000) / 1000
  return String(rounded)
}

export function expectedVideoCodec(): string {
  return 'h264'
}

export function nullDeviceFor(platform: string): string {
  return platform === 'win32' ? 'NUL' : '/dev/null'
}

export function verifyOutputMedia(
  media: MediaInfo,
  expected: {
    audio: 'present' | 'removed'
    maxLongSide: number | null
    maxShortSide: number | null
    frameRate: number | null
  }
): string[] {
  const problems: string[] = []
  if (media.fileSizeBytes <= 0) problems.push('The output file is empty.')
  if (media.videoStreams < 1 || media.videoCodec == null)
    problems.push('The output has no readable video stream.')
  if (media.videoCodec && media.videoCodec !== 'h264') {
    problems.push(`The output video codec is ${media.videoCodec}, not H.264.`)
  }
  if (expected.audio === 'removed' && media.hasAudio)
    problems.push('Audio was supposed to be removed.')
  if (expected.audio === 'present' && !media.hasAudio) problems.push('The output is missing audio.')
  if (
    expected.audio === 'present' &&
    media.audioCodec &&
    media.audioCodec !== 'aac' &&
    media.audioCodec !== 'copy'
  ) {
    if (media.audioCodec !== 'aac')
      problems.push(`The output audio codec is ${media.audioCodec}, not AAC.`)
  }
  if (media.displayWidth && media.displayHeight && expected.maxLongSide && expected.maxShortSide) {
    const longSide = Math.max(media.displayWidth, media.displayHeight)
    const shortSide = Math.min(media.displayWidth, media.displayHeight)
    if (longSide > expected.maxLongSide + 2 || shortSide > expected.maxShortSide + 2) {
      problems.push(
        `The output is ${media.displayWidth}×${media.displayHeight}, larger than the requested ${expected.maxLongSide}×${expected.maxShortSide} frame.`
      )
    }
  }
  if (expected.frameRate != null && media.frameRate != null) {
    const delta = Math.abs(media.frameRate - expected.frameRate)
    if (delta > 0.5 && delta / expected.frameRate > 0.02) {
      problems.push(
        `The output frame rate is ${media.frameRate.toFixed(3)} fps, not ${expected.frameRate} fps.`
      )
    }
  }
  return problems
}
