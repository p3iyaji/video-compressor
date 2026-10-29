import { stat } from 'node:fs/promises'
import { assertPlayableVideo, parseProbeJson, type FfprobeJson } from '../../shared/probe'
import type { MediaInfo } from '../../shared/types'
import { runProcess } from './process-runner'

export async function probeFile(ffprobePath: string, filePath: string): Promise<MediaInfo> {
  const info = await stat(filePath)
  if (!info.isFile()) throw new Error('That path is not a file.')
  const running = runProcess(ffprobePath, [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath
  ])
  let stdout = ''
  running.child.stdout?.setEncoding('utf8')
  running.child.stdout?.on('data', (chunk: string) => {
    stdout += chunk
  })
  const result = await running.done
  if (result.code !== 0) {
    const detail = result.stderr.trim()
    if (/invalid data|moov atom|invalid/i.test(detail)) {
      throw new Error(
        'This file could not be read. It may be corrupt, truncated, or not a valid MP4.'
      )
    }
    throw new Error(detail || 'FFprobe could not inspect this file.')
  }
  let parsed: FfprobeJson
  try {
    parsed = JSON.parse(stdout) as FfprobeJson
  } catch {
    throw new Error('FFprobe returned data that this app could not understand.')
  }
  const media = parseProbeJson(parsed, filePath, info.size)
  const problem = assertPlayableVideo(media)
  if (problem) throw new Error(problem)
  if (media.videoStreams < 1) {
    throw new Error('No video stream was found in this MP4.')
  }
  return media
}
