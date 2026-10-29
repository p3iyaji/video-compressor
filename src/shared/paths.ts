export type PathPlatform = 'posix' | 'win32'

const POSIX_BLOCKED = [
  '/etc',
  '/System',
  '/bin',
  '/sbin',
  '/usr/bin',
  '/usr/sbin',
  '/private/etc',
  '/var/root',
  '/dev',
  '/proc'
]

function separator(platform: PathPlatform): string {
  return platform === 'win32' ? '\\' : '/'
}

export function isMp4Path(filePath: string): boolean {
  const base = filePath.split(/[/\\]/).pop() ?? ''
  return base.toLowerCase().endsWith('.mp4') && !base.includes('\0')
}

export function isUnderPath(child: string, parent: string, platform: PathPlatform): boolean {
  const sep = separator(platform)
  const normalize = (value: string) => (platform === 'win32' ? value.toLowerCase() : value)
  const c = normalize(child)
  const p = normalize(parent).replace(/[\\/]+$/g, '')
  return c === p || c.startsWith(`${p}${sep}`)
}

export function isSensitivePath(filePath: string, platform: PathPlatform): boolean {
  if (filePath.includes('\0')) return true
  const normalized = platform === 'win32' ? filePath.replace(/\//g, '\\') : filePath
  const lower = normalized.toLowerCase()
  if (
    lower.includes(`${separator(platform)}.ssh${separator(platform)}`) ||
    lower.endsWith(`${separator(platform)}.ssh`)
  ) {
    return true
  }
  if (platform === 'win32') {
    return (
      /\\windows\\system32(\\|$)/i.test(normalized) ||
      /\\windows\\syswow64(\\|$)/i.test(normalized) ||
      /^[a-z]:\\windows(\\windows)?$/i.test(normalized)
    )
  }
  return POSIX_BLOCKED.some((blocked) => isUnderPath(normalized, blocked, 'posix'))
}

export interface PathValidationResult {
  ok: boolean
  errors: string[]
}

export function validateJobPaths(
  resolvedInput: string,
  resolvedOutput: string,
  platform: PathPlatform
): PathValidationResult {
  const errors: string[] = []
  if (!resolvedInput || !resolvedOutput) errors.push('Choose an input video and an output file.')
  if (resolvedInput.includes('\0') || resolvedOutput.includes('\0')) {
    errors.push('File paths cannot contain null characters.')
  }
  if (!isMp4Path(resolvedInput)) errors.push('The input must be an MP4 file.')
  if (!isMp4Path(resolvedOutput)) errors.push('The output file name must end in .mp4.')
  if (resolvedInput === resolvedOutput) {
    errors.push('The output path must be different from the original video.')
  }
  if (isSensitivePath(resolvedInput, platform) || isSensitivePath(resolvedOutput, platform)) {
    errors.push('That location is not available for compression.')
  }
  const sep = separator(platform)
  if (!resolvedInput.includes(sep) && !/^[a-zA-Z]:/.test(resolvedInput)) {
    errors.push('The input path must be absolute.')
  }
  if (!resolvedOutput.includes(sep) && !/^[a-zA-Z]:/.test(resolvedOutput)) {
    errors.push('The output path must be absolute.')
  }
  return { ok: errors.length === 0, errors }
}

export function assertCleanupSafe(paths: string[], inputPath: string): void {
  const input = inputPath.replace(/[\\/]+$/g, '')
  for (const candidate of paths) {
    if (candidate.replace(/[\\/]+$/g, '') === input) {
      throw new Error('Refusing to delete the original video.')
    }
  }
}
