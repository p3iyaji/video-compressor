import type { CompressionSettings, JobSnapshot, MediaInfo } from '../../src/shared/types'
import { createSettingsFromPreset } from '../../src/shared/presets'

export function mediaFixture(overrides: Partial<MediaInfo> = {}): MediaInfo {
  return {
    path: '/videos/my clip.mp4',
    fileName: 'my clip.mp4',
    fileSizeBytes: 1_200_000_000,
    durationSeconds: 60,
    width: 1920,
    height: 1080,
    displayWidth: 1920,
    displayHeight: 1080,
    frameRate: 30,
    videoCodec: 'h264',
    audioCodec: 'aac',
    videoBitrate: 8_000_000,
    audioBitrate: 160_000,
    overallBitrate: 8_200_000,
    pixelFormat: 'yuv420p',
    rotation: 0,
    sampleAspectRatio: 1,
    hasAudio: true,
    audioStreams: 1,
    videoStreams: 1,
    audioChannels: 2,
    isVfr: false,
    formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
    colorSpace: 'bt709',
    ...overrides
  }
}

export function balancedSettings(fileName = 'my clip.mp4'): CompressionSettings {
  return createSettingsFromPreset('balanced', fileName)
}

export function resultFor(job: JobSnapshot, outputBytes = 400_000_000) {
  return {
    inputSizeBytes: job.sourceSizeBytes,
    outputSizeBytes: outputBytes,
    savedBytes: job.sourceSizeBytes - outputBytes,
    savedPercent: ((job.sourceSizeBytes - outputBytes) / job.sourceSizeBytes) * 100,
    outputWidth: 1920,
    outputHeight: 1080,
    outputVideoCodec: 'h264',
    outputAudioCodec: 'aac',
    outputFrameRate: 30,
    encodingDurationSeconds: 1,
    outputBitrate: 1_000_000,
    targetBytes: null,
    targetMet: null,
    targetMessage: null,
    outputPath: job.outputPath,
    outputPlaybackUrl: job.outputPlaybackUrl,
    inputPlaybackUrl: job.inputPlaybackUrl,
    warnings: [],
    videoBitrateBps: null
  }
}
