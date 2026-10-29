import type { MediaInfo } from './types'

export interface FfprobeStream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  avg_frame_rate?: string
  r_frame_rate?: string
  pix_fmt?: string
  bit_rate?: string
  sample_aspect_ratio?: string
  channels?: number
  color_space?: string
  tags?: Record<string, string>
  side_data_list?: Array<{ rotation?: number; side_data_type?: string }>
}

export interface FfprobeJson {
  format?: {
    filename?: string
    format_name?: string
    duration?: string
    size?: string
    bit_rate?: string
  }
  streams?: FfprobeStream[]
}

export function parseRatio(value: string | undefined): number | null {
  if (!value || value === '0/0' || value === 'N/A') return null
  if (value.includes('/')) {
    const [numerator, denominator] = value.split('/').map(Number)
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0)
      return null
    const result = numerator / denominator
    return result > 0 && result < 1000 ? result : null
  }
  const asNumber = Number(value)
  return Number.isFinite(asNumber) && asNumber > 0 ? asNumber : null
}

export function normalizeRotation(value: number): number {
  if (!Number.isFinite(value)) return 0
  const rounded = ((Math.round(value) % 360) + 360) % 360
  if (rounded === 90 || rounded === 180 || rounded === 270) return rounded
  return 0
}

function positiveInt(value: string | number | undefined): number | null {
  if (value == null || value === 'N/A') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function readRotation(stream: FfprobeStream): number {
  const side = stream.side_data_list?.find((item) => typeof item.rotation === 'number')
  if (side?.rotation != null) return normalizeRotation(side.rotation)
  const tag = stream.tags?.rotate ?? stream.tags?.ROTATE
  if (tag != null) return normalizeRotation(Number(tag))
  return 0
}

export function parseProbeJson(
  json: FfprobeJson,
  filePath: string,
  fileSizeBytes: number
): MediaInfo {
  const streams = json.streams ?? []
  const videos = streams.filter((stream) => stream.codec_type === 'video')
  const audios = streams.filter((stream) => stream.codec_type === 'audio')
  const video = videos[0]
  const audio = audios[0]
  const width = video?.width ?? null
  const height = video?.height ?? null
  const rotation = video ? readRotation(video) : 0
  const sar = parseRatio(video?.sample_aspect_ratio) ?? 1
  let displayWidth = width
  let displayHeight = height
  if (width != null && height != null) {
    displayWidth = width * (sar > 0 ? sar : 1)
    displayHeight = height
    if (rotation === 90 || rotation === 270) {
      const swap = displayWidth
      displayWidth = displayHeight
      displayHeight = swap
    }
    displayWidth = Math.max(1, Math.round(displayWidth))
    displayHeight = Math.max(1, Math.round(displayHeight))
  }
  const avg = parseRatio(video?.avg_frame_rate)
  const raw = parseRatio(video?.r_frame_rate)
  const frameRate = avg ?? raw
  const isVfr =
    avg != null && raw != null && Math.abs(avg - raw) / Math.max(avg, raw) > 0.01 && raw < 240
  const duration = positiveInt(json.format?.duration) != null ? Number(json.format?.duration) : null
  const safeDuration = duration != null && duration > 0 ? duration : null
  const fileName = filePath.split(/[/\\]/).pop() ?? filePath

  return {
    path: filePath,
    fileName,
    fileSizeBytes,
    durationSeconds: safeDuration,
    width,
    height,
    displayWidth,
    displayHeight,
    frameRate,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    videoBitrate: positiveInt(video?.bit_rate),
    audioBitrate: positiveInt(audio?.bit_rate),
    overallBitrate: positiveInt(json.format?.bit_rate),
    pixelFormat: video?.pix_fmt ?? null,
    rotation,
    sampleAspectRatio: sar,
    hasAudio: audios.length > 0,
    audioStreams: audios.length,
    videoStreams: videos.length,
    audioChannels: audio?.channels ?? null,
    isVfr,
    formatName: json.format?.format_name ?? null,
    colorSpace: video?.color_space && video.color_space !== 'unknown' ? video.color_space : null
  }
}

export function assertPlayableVideo(media: MediaInfo): string | null {
  if (media.videoStreams < 1 || media.width == null || media.height == null) {
    return 'No video stream was found. Choose an MP4 that contains video.'
  }
  if (media.durationSeconds == null) {
    return null
  }
  if (media.durationSeconds <= 0) {
    return 'This file reports a duration of zero, so it cannot be compressed reliably.'
  }
  return null
}
