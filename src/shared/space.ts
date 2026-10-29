export interface SpaceSaved {
  savedBytes: number
  savedPercent: number
  largerThanSource: boolean
}

/**
 * (original - compressed) / original × 100.
 * A larger output produces a negative percentage. That is reported as-is.
 */
export function spaceSaved(originalBytes: number, compressedBytes: number): SpaceSaved {
  if (!Number.isFinite(originalBytes) || !Number.isFinite(compressedBytes)) {
    throw new Error('File sizes must be finite numbers.')
  }
  if (originalBytes < 0 || compressedBytes < 0) {
    throw new Error('File sizes cannot be negative.')
  }
  const savedBytes = originalBytes - compressedBytes
  const savedPercent = originalBytes === 0 ? 0 : (savedBytes / originalBytes) * 100
  return {
    savedBytes,
    savedPercent,
    largerThanSource: savedBytes < 0
  }
}

/** Target mode is a maximum budget. Small undershoot counts as met. Overshoot beyond tolerance does not. */
export function evaluateTarget(
  outputBytes: number,
  targetBytes: number,
  tolerance = 0.08
): { met: boolean; overshootRatio: number; message: string } {
  if (!(targetBytes > 0) || !(outputBytes >= 0)) {
    return {
      met: false,
      overshootRatio: 0,
      message: 'Target size could not be compared because the sizes were invalid.'
    }
  }
  const limit = targetBytes * (1 + tolerance)
  const overshootRatio = outputBytes / targetBytes - 1
  if (outputBytes <= limit) {
    if (outputBytes <= targetBytes) {
      return {
        met: true,
        overshootRatio,
        message: 'Within the requested size budget.'
      }
    }
    return {
      met: true,
      overshootRatio,
      message: `Slightly over the budget, inside the ${Math.round(tolerance * 100)}% tolerance.`
    }
  }
  return {
    met: false,
    overshootRatio,
    message: `Larger than the requested budget by ${Math.round(overshootRatio * 100)}%. The target was not met.`
  }
}

export function adjustBitrateForRetry(
  previousVideoBps: number,
  targetBytes: number,
  outputBytes: number
): number {
  if (!(previousVideoBps > 0) || !(targetBytes > 0) || !(outputBytes > 0)) {
    throw new Error('Retry bitrate needs a previous bitrate, target size, and actual output size.')
  }
  const scaled = previousVideoBps * (targetBytes / outputBytes) * 0.95
  return Math.max(100_000, Math.floor(scaled))
}
