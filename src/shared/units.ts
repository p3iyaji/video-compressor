/** Decimal units. 1 MB = 1,000,000 bytes, matching FFmpeg bitrates and modern file managers. */
export const BYTES_PER_KB = 1_000
export const BYTES_PER_MB = 1_000_000
export const BYTES_PER_GB = 1_000_000_000

export type SizeUnit = 'MB' | 'GB'

export function targetSizeToBytes(value: number, unit: SizeUnit): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Target size must be a number greater than zero.')
  }
  const factor = unit === 'GB' ? BYTES_PER_GB : BYTES_PER_MB
  const bytes = value * factor
  if (!Number.isFinite(bytes) || bytes > Number.MAX_SAFE_INTEGER) {
    throw new Error('Target size is too large to calculate safely.')
  }
  return Math.round(bytes)
}

export function bytesToTargetValue(bytes: number, unit: SizeUnit): number {
  const factor = unit === 'GB' ? BYTES_PER_GB : BYTES_PER_MB
  return bytes / factor
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return 'Unknown'
  const sign = bytes < 0 ? '-' : ''
  let value = Math.abs(bytes)
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit += 1
  }
  const digits = unit === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2
  return `${sign}${value.toFixed(digits)} ${units[unit]}`
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return 'Unknown'
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`
}

export function formatBitrate(bitsPerSecond: number | null | undefined): string {
  if (bitsPerSecond == null || !Number.isFinite(bitsPerSecond) || bitsPerSecond < 0) {
    return 'Unknown'
  }
  if (bitsPerSecond >= 1_000_000) return `${(bitsPerSecond / 1_000_000).toFixed(2)} Mbps`
  return `${Math.round(bitsPerSecond / 1000)} kbps`
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return 'Unknown'
  return `${value.toFixed(digits)}%`
}

export function formatClock(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—'
  return formatDuration(seconds)
}

export function formatSpeed(speed: number | null | undefined): string {
  if (speed == null || !Number.isFinite(speed) || speed <= 0) return '—'
  return `${speed.toFixed(2)}×`
}
