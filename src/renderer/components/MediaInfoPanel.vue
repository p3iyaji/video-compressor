<script setup lang="ts">
import { computed } from 'vue'
import type { MediaInfo } from '../../shared/types'
import { formatBitrate, formatBytes, formatDuration } from '../../shared/units'

const props = defineProps<{ media: MediaInfo }>()

function rate(value: number | null): string {
  if (value == null) return 'Unknown'
  const rounded = Math.round(value * 1000) / 1000
  return `${rounded} fps`
}

const facts = computed(() => {
  const media = props.media
  const resolution =
    media.displayWidth && media.displayHeight
      ? `${media.displayWidth}×${media.displayHeight}`
      : 'Unknown'
  return [
    ['File', media.fileName],
    ['Size', formatBytes(media.fileSizeBytes)],
    ['Duration', formatDuration(media.durationSeconds)],
    ['Resolution', resolution],
    ['Frame rate', rate(media.frameRate)],
    ['Video', media.videoCodec ?? 'Unknown'],
    ['Audio', media.hasAudio ? (media.audioCodec ?? 'Unknown') : 'None'],
    ['Bitrate', formatBitrate(media.overallBitrate)]
  ]
})
</script>

<template>
  <section class="rounded-3xl border border-stroke bg-panel p-5">
    <h2 class="text-sm font-semibold uppercase tracking-[0.16em] text-mist">Source</h2>
    <dl class="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
      <div v-for="item in facts" :key="item[0]" class="rounded-2xl bg-raised px-3 py-3">
        <dt class="text-xs uppercase tracking-wide text-mist">{{ item[0] }}</dt>
        <dd class="mt-1 truncate text-sm font-medium">{{ item[1] }}</dd>
      </div>
    </dl>
    <p v-if="media.rotation" class="mt-3 text-sm text-mist">
      Display rotation {{ media.rotation }}° is preserved visually when the video is re-encoded.
    </p>
    <p v-if="media.isVfr" class="mt-2 text-sm text-mist">
      This file looks variable-frame-rate. Original frame rate keeps that timing instead of forcing
      a new one.
    </p>
  </section>
</template>
