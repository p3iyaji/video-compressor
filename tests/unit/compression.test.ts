import { describe, expect, it } from 'vitest'
import {
  audioBudgetBitsPerSecond,
  bitsPerPixel,
  calculateTargetBitrate,
  CONTAINER_OVERHEAD_RATIO,
  estimateCrfBytes
} from '../../src/shared/bitrate'
import { resolveOutputDimensions } from '../../src/shared/dimensions'
import {
  buildFfmpegPasses,
  crfToVideoToolboxQuality,
  nullDeviceFor
} from '../../src/shared/ffmpeg-args'
import { defaultOutputFileName, sanitizeFileName } from '../../src/shared/filenames'
import { parseEncoderList } from '../../src/shared/encoders'
import { assertCleanupSafe, validateJobPaths } from '../../src/shared/paths'
import { buildEncodePlan } from '../../src/shared/plan'
import { PRESETS, presetSpecIssues } from '../../src/shared/presets'
import { parseProbeJson, parseRatio } from '../../src/shared/probe'
import {
  explainFfmpegError,
  estimateEta,
  percentFromTime,
  ProgressParser
} from '../../src/shared/progress'
import { adjustBitrateForRetry, evaluateTarget, spaceSaved } from '../../src/shared/space'
import { bytesToTargetValue, formatBytes, targetSizeToBytes } from '../../src/shared/units'
import { validateCompressionSettings, validateCrf } from '../../src/shared/validation'
import { balancedSettings, mediaFixture } from '../helpers/fixtures'

describe('units', () => {
  it('converts decimal MB and GB', () => {
    expect(targetSizeToBytes(100, 'MB')).toBe(100_000_000)
    expect(targetSizeToBytes(1.2, 'GB')).toBe(1_200_000_000)
    expect(bytesToTargetValue(100_000_000, 'MB')).toBe(100)
    expect(formatBytes(1_200_000_000)).toBe('1.20 GB')
  })

  it('rejects empty or invalid targets', () => {
    expect(() => targetSizeToBytes(0, 'MB')).toThrow(/greater than zero/)
    expect(() => targetSizeToBytes(-5, 'GB')).toThrow(/greater than zero/)
    expect(() => targetSizeToBytes(Number.NaN, 'MB')).toThrow(/greater than zero/)
  })
})

describe('space saved', () => {
  it('reports the percentage and a negative saving honestly', () => {
    expect(spaceSaved(1_000, 400)).toMatchObject({
      savedBytes: 600,
      savedPercent: 60,
      largerThanSource: false
    })
    expect(spaceSaved(1_000, 1_000).savedPercent).toBe(0)
    expect(spaceSaved(1_000, 1_200)).toMatchObject({
      savedBytes: -200,
      savedPercent: -20,
      largerThanSource: true
    })
    expect(spaceSaved(0, 0).savedPercent).toBe(0)
  })

  it('treats a target as a budget and does not call a large overshoot a success', () => {
    expect(evaluateTarget(90, 100).met).toBe(true)
    expect(evaluateTarget(109, 100).met).toBe(false)
    expect(evaluateTarget(104, 100).met).toBe(true)
  })
})

describe('bitrate budget', () => {
  it('reserves container overhead and audio before the video bitrate', () => {
    const plan = calculateTargetBitrate({
      targetBytes: 100_000_000,
      durationSeconds: 60,
      audioBitsPerSecond: 160_000,
      width: 1920,
      height: 1080,
      fps: 30
    })
    const total = (100_000_000 * 8) / 60
    expect(plan.ok).toBe(true)
    expect(plan.totalBitsPerSecond).toBeCloseTo(total)
    expect(plan.overheadBitsPerSecond).toBeCloseTo(total * CONTAINER_OVERHEAD_RATIO)
    expect(plan.videoBitsPerSecond).toBeCloseTo(total - total * CONTAINER_OVERHEAD_RATIO - 160_000)
    expect(plan.videoBitrateKbps).toBe(Math.floor(plan.videoBitsPerSecond / 1000))
  })

  it('handles a missing source bitrate, missing audio, and zero duration', () => {
    const missingBitrate = calculateTargetBitrate({
      targetBytes: 50_000_000,
      durationSeconds: 30,
      audioBitsPerSecond: 128_000,
      width: 1280,
      height: 720,
      fps: 30
    })
    expect(missingBitrate.ok).toBe(true)
    const silent = calculateTargetBitrate({
      targetBytes: 50_000_000,
      durationSeconds: 30,
      audioBitsPerSecond: 0,
      width: 1280,
      height: 720,
      fps: 30
    })
    expect(silent.videoBitsPerSecond).toBeGreaterThan(missingBitrate.videoBitsPerSecond)
    const zero = calculateTargetBitrate({
      targetBytes: 50_000_000,
      durationSeconds: 0,
      audioBitsPerSecond: 0,
      width: 1280,
      height: 720,
      fps: 30
    })
    expect(zero.ok).toBe(false)
    expect(zero.error).toMatch(/duration/i)
  })

  it('rejects a target below the practical video floor and offers a quality alternative', () => {
    const plan = calculateTargetBitrate({
      targetBytes: 1_000,
      durationSeconds: 1,
      audioBitsPerSecond: 160_000,
      width: 1920,
      height: 1080,
      fps: 30
    })
    expect(plan.ok).toBe(false)
    expect(plan.tooAggressive).toBe(true)
    expect(plan.alternative?.presetId).toBe('balanced')
  })

  it('warns when the picture would be starved but the bitrate is still encodable', () => {
    const width = 1920
    const height = 1080
    const fps = 30
    const videoBps = bitsPerPixel(1, width, height, fps)! * width * height * fps
    expect(videoBps).toBeCloseTo(1)
    const poorBpp = 0.02
    const video = poorBpp * width * height * fps
    const audio = 96_000
    const total = (video + audio) / (1 - CONTAINER_OVERHEAD_RATIO)
    const plan = calculateTargetBitrate({
      targetBytes: Math.round((total * 10) / 8),
      durationSeconds: 10,
      audioBitsPerSecond: audio,
      width,
      height,
      fps
    })
    expect(plan.ok).toBe(true)
    expect(plan.poorQuality).toBe(true)
  })

  it('budgets copied audio from the source and removed audio as zero', () => {
    expect(
      audioBudgetBitsPerSecond({
        audioMode: 'remove',
        selectedBitrateKbps: 160,
        sourceAudioBitrate: 256_000
      })
    ).toBe(0)
    expect(
      audioBudgetBitsPerSecond({
        audioMode: 'copy',
        selectedBitrateKbps: 160,
        sourceAudioBitrate: 256_000
      })
    ).toBe(256_000)
    expect(
      audioBudgetBitsPerSecond({
        audioMode: 'aac',
        selectedBitrateKbps: 160,
        sourceAudioBitrate: null
      })
    ).toBe(160_000)
    expect(
      audioBudgetBitsPerSecond({
        audioMode: 'copy',
        selectedBitrateKbps: 128,
        sourceAudioBitrate: null
      })
    ).toBe(128_000)
  })

  it('estimates CRF size as an estimate, not a guarantee', () => {
    const bytes = estimateCrfBytes({
      crf: 23,
      width: 1920,
      height: 1080,
      fps: 30,
      durationSeconds: 10,
      audioBitsPerSecond: 160_000,
      preset: 'medium'
    })
    expect(bytes).toBeGreaterThan(0)
    expect(
      estimateCrfBytes({
        crf: 23,
        width: 1920,
        height: 1080,
        fps: 30,
        durationSeconds: null,
        audioBitsPerSecond: 0,
        preset: 'medium'
      })
    ).toBeNull()
    const retry = adjustBitrateForRetry(2_000_000, 100_000_000, 150_000_000)
    expect(retry).toBeLessThan(2_000_000)
    expect(retry).toBeGreaterThanOrEqual(100_000)
  })
})

describe('presets and validation', () => {
  it('keeps built-in presets inside the published CRF ranges', () => {
    for (const preset of Object.values(PRESETS)) {
      expect(presetSpecIssues(preset)).toEqual([])
      expect(validateCrf(preset.crf)).toBeNull()
    }
    expect(PRESETS.maximum.x264Preset).toBe('slow')
    expect(PRESETS.small.crf).toBeGreaterThanOrEqual(25)
    expect(PRESETS.facebook.resolution).toEqual({ mode: 'height', height: 1080 })
  })

  it('rejects an illegal CRF, audio bitrate, and frame rate', () => {
    const settings = balancedSettings()
    expect(validateCompressionSettings(settings).ok).toBe(true)
    expect(
      validateCompressionSettings({ ...settings, rateControl: { mode: 'crf', crf: 52 } }).ok
    ).toBe(false)
    expect(validateCompressionSettings({ ...settings, audioBitrateKbps: 320 }).ok).toBe(false)
    expect(
      validateCompressionSettings({ ...settings, frameRate: { mode: 'value', fps: 0 } }).ok
    ).toBe(false)
    expect(validateCompressionSettings({ ...settings, x264Preset: 'placebo' }).ok).toBe(false)
  })
})

describe('dimensions', () => {
  it('never upscales and preserves aspect ratio inside a 1080p frame', () => {
    expect(resolveOutputDimensions(640, 360, { mode: 'height', height: 1080 })).toMatchObject({
      width: 640,
      height: 360,
      scaled: false
    })
    const hd = resolveOutputDimensions(3840, 2160, { mode: 'height', height: 1080 })
    expect(hd).toMatchObject({ width: 1920, height: 1080, scaled: true })
    const portrait = resolveOutputDimensions(2160, 3840, { mode: 'height', height: 1080 })
    expect(portrait.width).toBeLessThanOrEqual(1080)
    expect(portrait.height).toBeLessThanOrEqual(1920)
    expect(portrait.width).toBeLessThan(2160)
    const odd = resolveOutputDimensions(1919, 1080, { mode: 'original' })
    expect(odd.width % 2).toBe(0)
    expect(odd.height % 2).toBe(0)
  })
})

describe('filenames and paths', () => {
  it('sanitises names without destroying unicode or spaces', () => {
    expect(sanitizeFileName('holiday video.mp4')).toBe('holiday video.mp4')
    expect(sanitizeFileName('видео')).toBe('видео.mp4')
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd.mp4')
    expect(sanitizeFileName('file?.mp4')).toBe('file_.mp4')
    expect(sanitizeFileName('')).toBe('compressed.mp4')
    expect(sanitizeFileName('con')).toBe('_con.mp4')
    expect(defaultOutputFileName('Trip.MP4', 'facebook')).toBe('Trip.facebook.mp4')
  })

  it('rejects the same input and output, non-mp4 output, and sensitive locations', () => {
    expect(validateJobPaths('/videos/a.mp4', '/videos/b.mp4', 'posix').ok).toBe(true)
    expect(validateJobPaths('/videos/a.mp4', '/videos/a.mp4', 'posix').errors.join(' ')).toMatch(
      /different/
    )
    expect(validateJobPaths('/videos/a.mp4', '/videos/b.mov', 'posix').ok).toBe(false)
    expect(validateJobPaths('/videos/a.mp4\0', '/videos/b.mp4', 'posix').ok).toBe(false)
    expect(validateJobPaths('/etc/secret.mp4', '/videos/b.mp4', 'posix').ok).toBe(false)
    expect(validateJobPaths('C:\\Videos\\a.mp4', 'C:\\Videos\\b.mp4', 'win32').ok).toBe(true)
    expect(validateJobPaths('C:\\Windows\\System32\\a.mp4', 'D:\\out\\b.mp4', 'win32').ok).toBe(
      false
    )
    expect(() => assertCleanupSafe(['/videos/a.mp4.partial'], '/videos/a.mp4')).not.toThrow()
    expect(() => assertCleanupSafe(['/videos/a.mp4'], '/videos/a.mp4')).toThrow(/original/)
  })
})

describe('ffmpeg arguments', () => {
  it('builds a single quality pass as an argument array', () => {
    const plan = buildEncodePlan(mediaFixture(), balancedSettings())
    expect(plan.errors).toEqual([])
    expect(plan.options.scale).toBe(false)
    const passes = buildFfmpegPasses({
      inputPath: '/videos/my clip.mp4',
      tempOutputPath: '/videos/out.partial.mp4',
      passLogPrefix: '/tmp/job/pass',
      nullDevice: nullDeviceFor('darwin'),
      options: plan.options
    })
    expect(passes).toHaveLength(1)
    expect(passes[0].args).toEqual([
      '-hide_banner',
      '-loglevel',
      'warning',
      '-y',
      '-i',
      '/videos/my clip.mp4',
      '-map',
      '0:v:0',
      '-map',
      '0:a:0',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-pix_fmt',
      'yuv420p',
      '-profile:v',
      'high',
      '-level:v',
      '4.2',
      '-fps_mode',
      'passthrough',
      '-crf',
      '23',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      '-map_metadata',
      '0',
      '-map_chapters',
      '0',
      '-avoid_negative_ts',
      'make_zero',
      '-max_muxing_queue_size',
      '1024',
      '-colorspace',
      'bt709',
      '-progress',
      'pipe:1',
      '-nostats',
      '-movflags',
      '+faststart',
      '/videos/out.partial.mp4'
    ])
    expect(passes[0].args.filter((arg) => arg === '/videos/my clip.mp4')).toHaveLength(1)
  })

  it('uses two libx264 passes only for target bitrate mode', () => {
    const settings = balancedSettings()
    settings.rateControl = { mode: 'size', targetBytes: 20_000_000, twoPass: true }
    settings.x264Preset = 'veryfast'
    const plan = buildEncodePlan(mediaFixture(), settings)
    const passes = buildFfmpegPasses({
      inputPath: '/videos/my clip.mp4',
      tempOutputPath: '/videos/out.partial.mp4',
      passLogPrefix: '/tmp/job/pass',
      nullDevice: nullDeviceFor('win32'),
      options: plan.options
    })
    expect(passes.map((pass) => pass.label)).toEqual(['pass1', 'pass2'])
    expect(passes[0].args).toContain('NUL')
    expect(passes[0].args).toContain('-an')
    expect(passes[1].args).toContain('-pass')
    expect(passes[1].args).toContain('/videos/out.partial.mp4')
    expect(passes[1].args).not.toContain('NUL')
    const hardware = buildEncodePlan(mediaFixture(), { ...settings, encoder: 'h264_videotoolbox' })
    expect(hardware.options.twoPass).toBe(false)
    expect(hardware.warnings.join(' ')).toMatch(/single bitrate pass/)
  })

  it('removes audio, caps facebook resolution, and does not upscale', () => {
    const silent = buildEncodePlan(
      mediaFixture({ hasAudio: false, audioCodec: null, audioStreams: 0 }),
      balancedSettings()
    )
    expect(silent.options.audioMode).toBe('remove')
    const facebook = buildEncodePlan(
      mediaFixture({ displayWidth: 3840, displayHeight: 2160, width: 3840, height: 2160 }),
      {
        ...balancedSettings(),
        ...{
          presetId: 'facebook' as const,
          resolution: { mode: 'height' as const, height: 1080 as const }
        }
      }
    )
    expect(facebook.options.scale).toBe(true)
    expect(facebook.options.width).toBe(1920)
    expect(facebook.options.height).toBe(1080)
    const small = buildEncodePlan(
      mediaFixture({ displayWidth: 640, displayHeight: 360, width: 640, height: 360 }),
      { ...balancedSettings(), resolution: { mode: 'height', height: 1080 } }
    )
    expect(small.options.scale).toBe(false)
    expect(small.options.width).toBe(640)
    expect(crfToVideoToolboxQuality(23)).toBeGreaterThan(40)
    expect(nullDeviceFor('win32')).toBe('NUL')
  })
})

describe('progress and errors', () => {
  it('parses machine-readable progress across split chunks', () => {
    const parser = new ProgressParser()
    expect(parser.push('frame=10\nfps=30.0\n')).toBeNull()
    const snapshot = parser.push(
      'out_time_us=1500000\nspeed=1.5x\ntotal_size=2000\nprogress=continue\n'
    )
    expect(snapshot).toMatchObject({
      outTimeSeconds: 1.5,
      speed: 1.5,
      fps: 30,
      totalSizeBytes: 2000,
      finished: false
    })
    expect(percentFromTime(1.5, 3)).toBe(50)
    expect(percentFromTime(1, null)).toBeNull()
    expect(percentFromTime(1, 0)).toBeNull()
    const end = parser.push('progress=end\n')
    expect(end?.finished).toBe(true)
    expect(
      estimateEta({
        percent: 50,
        elapsedSeconds: 4,
        speed: 2,
        durationSeconds: 10,
        outTimeSeconds: 4
      })
    ).toBeCloseTo(3)
    expect(
      estimateEta({
        percent: null,
        elapsedSeconds: 1,
        speed: null,
        durationSeconds: null,
        outTimeSeconds: null
      })
    ).toBeNull()
  })

  it('explains corrupt files, disk space, and hardware failures', () => {
    expect(explainFfmpegError('moov atom not found', 1)).toMatch(/corrupt/i)
    expect(explainFfmpegError('No space left on device', 1)).toMatch(/disk/i)
    expect(explainFfmpegError('Unknown encoder libx264', 1)).toMatch(/libx264/)
    expect(explainFfmpegError('Cannot create compression session', 187)).toMatch(
      /Hardware encoding failed/
    )
    expect(explainFfmpegError('', null)).toMatch(/Encoding failed/)
  })
})

describe('ffprobe json', () => {
  it('reads streams, missing audio, rotation, and zero duration', () => {
    const parsed = parseProbeJson(
      {
        format: { duration: '12.5', bit_rate: '1000', format_name: 'mov,mp4' },
        streams: [
          {
            codec_type: 'video',
            codec_name: 'h264',
            width: 1920,
            height: 1080,
            avg_frame_rate: '30000/1001',
            r_frame_rate: '30000/1001',
            pix_fmt: 'yuv420p',
            color_space: 'bt709',
            side_data_list: [{ rotation: -90 }]
          },
          { codec_type: 'audio', codec_name: 'aac', bit_rate: '128000', channels: 2 }
        ]
      },
      '/videos/clip.mp4',
      50
    )
    expect(parsed.durationSeconds).toBe(12.5)
    expect(parsed.rotation).toBe(270)
    expect(parsed.displayWidth).toBe(1080)
    expect(parsed.displayHeight).toBe(1920)
    expect(parsed.frameRate).toBeCloseTo(29.97, 2)
    expect(parsed.hasAudio).toBe(true)
    expect(parseRatio('0/0')).toBeNull()
    expect(parseRatio(undefined)).toBeNull()

    const silent = parseProbeJson(
      {
        format: { duration: '2', bit_rate: 'N/A' },
        streams: [
          {
            codec_type: 'video',
            codec_name: 'h264',
            width: 320,
            height: 240,
            avg_frame_rate: '24/1',
            r_frame_rate: '24/1'
          }
        ]
      },
      '/videos/silent.mp4',
      10
    )
    expect(silent.hasAudio).toBe(false)
    expect(silent.audioCodec).toBeNull()
    expect(silent.overallBitrate).toBeNull()

    const zero = parseProbeJson({ format: { duration: '0' }, streams: [] }, '/videos/empty.mp4', 0)
    expect(zero.durationSeconds).toBeNull()
    expect(zero.videoStreams).toBe(0)
  })
})

describe('encoder inventory', () => {
  it('detects only encoders the ffmpeg listing actually contains', () => {
    const sample = `
 V..... libx264              libx264 H.264
 V..... h264_videotoolbox    VideoToolbox H.264 Encoder
`
    expect(parseEncoderList(sample)).toEqual(['libx264', 'h264_videotoolbox'])
  })
})
