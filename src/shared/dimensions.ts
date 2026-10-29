import type { ResolutionChoice, StandardHeight } from './types'

export interface OutputDimensions {
  width: number
  height: number
  scaled: boolean
  capped: boolean
  warning: string | null
}

const BOXES: Record<StandardHeight, { longSide: number; shortSide: number }> = {
  2160: { longSide: 3840, shortSide: 2160 },
  1440: { longSide: 2560, shortSide: 1440 },
  1080: { longSide: 1920, shortSide: 1080 },
  720: { longSide: 1280, shortSide: 720 }
}

function even(value: number): number {
  const floored = Math.floor(value)
  const rounded = floored - (floored % 2)
  return Math.max(2, rounded)
}

export function resolveOutputDimensions(
  sourceWidth: number,
  sourceHeight: number,
  choice: ResolutionChoice
): OutputDimensions {
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) {
    throw new Error('Source dimensions are required before choosing an output size.')
  }
  const srcW = even(sourceWidth)
  const srcH = even(sourceHeight)
  const oddAdjusted = srcW !== sourceWidth || srcH !== sourceHeight

  if (choice.mode === 'original') {
    return {
      width: srcW,
      height: srcH,
      scaled: false,
      capped: false,
      warning: oddAdjusted
        ? 'Width and height were rounded to even numbers so H.264 yuv420p can encode them.'
        : null
    }
  }

  const box =
    choice.mode === 'height'
      ? BOXES[choice.height]
      : {
          longSide: Math.max(even(choice.width), even(choice.height)),
          shortSide: Math.min(even(choice.width), even(choice.height))
        }

  const srcLong = Math.max(srcW, srcH)
  const srcShort = Math.min(srcW, srcH)
  if (srcLong <= box.longSide && srcShort <= box.shortSide) {
    return {
      width: srcW,
      height: srcH,
      scaled: false,
      capped: false,
      warning: 'The source is already within the selected frame, so it was not upscaled.'
    }
  }

  const scale = Math.min(box.longSide / srcLong, box.shortSide / srcShort)
  const landscape = srcW >= srcH
  const width = even((landscape ? srcLong : srcShort) * scale)
  const height = even((landscape ? srcShort : srcLong) * scale)
  return {
    width,
    height,
    scaled: true,
    capped: true,
    warning: null
  }
}

export function resolutionLabel(width: number, height: number): string {
  return `${width}×${height}`
}
