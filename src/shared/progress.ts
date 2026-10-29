import type { ParsedProgress } from './types'

export class ProgressParser {
  private buffer = ''
  private fields: Record<string, string> = {}

  push(chunk: string): ParsedProgress | null {
    this.buffer += chunk
    const lines = this.buffer.split(/\r\n|\n|\r/)
    this.buffer = lines.pop() ?? ''
    let snapshot: ParsedProgress | null = null
    for (const line of lines) {
      const index = line.indexOf('=')
      if (index <= 0) continue
      const key = line.slice(0, index).trim()
      const value = line.slice(index + 1).trim()
      this.fields[key] = value
      if (key === 'progress') snapshot = snapshotFromFields(this.fields)
    }
    return snapshot
  }
}

function numberOrNull(value: string | undefined): number | null {
  if (!value || value === 'N/A') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function snapshotFromFields(fields: Record<string, string>): ParsedProgress {
  const outTimeUs = numberOrNull(fields.out_time_us)
  const outTimeSeconds = outTimeUs == null ? parseTimestamp(fields.out_time) : outTimeUs / 1_000_000
  const speedText = fields.speed?.replace('x', '').trim()
  const speed = numberOrNull(speedText)
  return {
    outTimeSeconds,
    speed: speed != null && speed > 0 ? speed : null,
    fps: numberOrNull(fields.fps),
    totalSizeBytes: numberOrNull(fields.total_size),
    finished: fields.progress === 'end'
  }
}

function parseTimestamp(value: string | undefined): number | null {
  if (!value || value === 'N/A') return null
  const match = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(value)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  return hours * 3600 + minutes * 60 + seconds
}

export function percentFromTime(
  outTimeSeconds: number | null,
  durationSeconds: number | null
): number | null {
  if (outTimeSeconds == null || durationSeconds == null || !(durationSeconds > 0)) return null
  return Math.max(0, Math.min(100, (outTimeSeconds / durationSeconds) * 100))
}

export function estimateEta(input: {
  percent: number | null
  elapsedSeconds: number
  speed: number | null
  durationSeconds: number | null
  outTimeSeconds: number | null
}): number | null {
  const { percent, elapsedSeconds, speed, durationSeconds, outTimeSeconds } = input
  if (
    speed != null &&
    speed >= 0.05 &&
    durationSeconds != null &&
    outTimeSeconds != null &&
    durationSeconds > outTimeSeconds
  ) {
    return (durationSeconds - outTimeSeconds) / speed
  }
  if (percent != null && percent >= 1 && percent < 99.5 && elapsedSeconds >= 1) {
    return (elapsedSeconds * (100 - percent)) / percent
  }
  return null
}

export function explainFfmpegError(stderr: string, exitCode: number | null): string {
  const text = stderr.toLowerCase()
  if (
    text.includes('no space left') ||
    text.includes('disk quota exceeded') ||
    text.includes('not enough space')
  ) {
    return 'The disk ran out of space during encoding. Free some space and try again. The original video was not changed.'
  }
  if (
    text.includes('invalid data') ||
    text.includes('moov atom not found') ||
    text.includes('error opening input') ||
    (text.includes('invalid argument') && text.includes('opening input'))
  ) {
    return 'FFmpeg could not read this file. It may be corrupt, incomplete, or not a valid MP4.'
  }
  if (text.includes('unknown encoder') || text.includes('encoder not found')) {
    return 'This FFmpeg build does not include the selected encoder. Software encoding with libx264 is the reliable fallback.'
  }
  if (text.includes('permission denied')) {
    return 'FFmpeg could not read the input or write the output. Check the file permissions and destination folder.'
  }
  if (
    text.includes('cannot create compression session') ||
    text.includes('hardware encoder may be busy')
  ) {
    return 'Hardware encoding failed. The encoder may be busy or unavailable in this session. Use software encoding instead.'
  }
  const tail = stderr
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-3)
    .join(' ')
  if (tail) return `Encoding failed${exitCode == null ? '' : ` (exit ${exitCode})`}. ${tail}`
  return `Encoding failed${exitCode == null ? '' : ` (exit ${exitCode})`}.`
}
