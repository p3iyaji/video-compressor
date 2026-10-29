import { statfs } from 'node:fs/promises'

export async function freeBytes(directory: string): Promise<number | null> {
  try {
    const stats = await statfs(directory)
    return Number(stats.bavail) * Number(stats.bsize)
  } catch {
    return null
  }
}
