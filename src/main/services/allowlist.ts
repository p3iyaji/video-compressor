import { randomBytes } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { isMp4Path, isSensitivePath, validateJobPaths, type PathPlatform } from '../../shared/paths'

export class MediaAllowlist {
  private readonly tokens = new Map<string, string>()
  private readonly inputs = new Set<string>()
  private readonly outputDirs = new Set<string>()

  authorizeInput(realInput: string): string {
    this.inputs.add(realInput)
    this.outputDirs.add(dirname(realInput))
    return this.tokenFor(realInput)
  }

  authorizeOutputDir(realDir: string): void {
    this.outputDirs.add(realDir)
  }

  hasInput(realInput: string): boolean {
    return this.inputs.has(realInput)
  }

  hasOutputDir(realDir: string): boolean {
    return this.outputDirs.has(realDir)
  }

  tokenFor(realPath: string): string {
    for (const [token, filePath] of this.tokens) {
      if (filePath === realPath) return token
    }
    const token = randomBytes(16).toString('hex')
    this.tokens.set(token, realPath)
    return token
  }

  resolveToken(token: string): string | null {
    if (!/^[a-f0-9]{32}$/.test(token)) return null
    return this.tokens.get(token) ?? null
  }

  playbackUrl(realPath: string): string {
    return `media://local/${this.tokenFor(realPath)}`
  }
}

export async function resolveExistingFile(filePath: string): Promise<string> {
  if (
    typeof filePath !== 'string' ||
    filePath.length === 0 ||
    filePath.length > 4096 ||
    filePath.includes('\0')
  ) {
    throw new Error('That file path is not valid.')
  }
  const resolved = resolve(filePath)
  const real = await realpath(resolved)
  const info = await stat(real)
  if (!info.isFile()) throw new Error('Choose a file, not a folder.')
  return real
}

export async function resolveDirectory(dirPath: string): Promise<string> {
  if (
    typeof dirPath !== 'string' ||
    dirPath.length === 0 ||
    dirPath.length > 4096 ||
    dirPath.includes('\0')
  ) {
    throw new Error('That folder path is not valid.')
  }
  const resolved = resolve(dirPath)
  const real = await realpath(resolved)
  const info = await stat(real)
  if (!info.isDirectory()) throw new Error('Choose a folder for the compressed video.')
  return real
}

export function assertInputAllowed(realPath: string, platform: PathPlatform): void {
  if (!isMp4Path(realPath))
    throw new Error('Choose an MP4 file. Other containers are not accepted.')
  if (isSensitivePath(realPath, platform))
    throw new Error('That location is not available for compression.')
}

export function assertOutputAllowed(realDir: string, platform: PathPlatform): void {
  if (isSensitivePath(realDir, platform))
    throw new Error('That destination folder is not available.')
}

export function platformOf(platform: NodeJS.Platform): PathPlatform {
  return platform === 'win32' ? 'win32' : 'posix'
}

export function checkOutputPair(
  inputPath: string,
  outputPath: string,
  platform: PathPlatform
): void {
  const result = validateJobPaths(inputPath, outputPath, platform)
  if (!result.ok) throw new Error(result.errors[0] ?? 'The output path is not valid.')
}
