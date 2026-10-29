<script setup lang="ts">
import { FolderOpen, Play, Save, Columns2, RotateCcw } from '@lucide/vue'
import type { JobSnapshot } from '../../shared/types'
import { formatBitrate, formatBytes, formatClock, formatDuration } from '../../shared/units'

defineProps<{ job: JobSnapshot; compare: boolean }>()
const emit = defineEmits<{
  reveal: [path: string]
  play: [path: string]
  'save-copy': [path: string]
  compare: []
  retry: [id: string]
  another: []
}>()
</script>

<template>
  <section v-if="job.result" class="rounded-3xl border border-stroke bg-panel p-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold">Output verified</h2>
        <p class="text-sm text-mist">FFmpeg finished and FFprobe could read the new MP4.</p>
      </div>
      <p
        class="text-3xl font-semibold tracking-tight"
        :class="job.result.savedPercent < 0 ? 'text-coral' : 'text-mint'"
      >
        {{ job.result.savedPercent.toFixed(1) }}%
      </p>
    </div>
    <p v-if="job.result.savedPercent < 0" class="mt-2 text-sm text-coral">
      The compressed file is larger than the original. The saving is negative because that is what
      the sizes show.
    </p>
    <dl class="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
      <div>
        <dt class="text-mist">Original</dt>
        <dd>{{ formatBytes(job.result.inputSizeBytes) }}</dd>
      </div>
      <div>
        <dt class="text-mist">Compressed</dt>
        <dd>{{ formatBytes(job.result.outputSizeBytes) }}</dd>
      </div>
      <div>
        <dt class="text-mist">Space saved</dt>
        <dd>{{ formatBytes(job.result.savedBytes) }}</dd>
      </div>
      <div>
        <dt class="text-mist">Encode time</dt>
        <dd>{{ formatDuration(job.result.encodingDurationSeconds) }}</dd>
      </div>
      <div>
        <dt class="text-mist">Resolution</dt>
        <dd>{{ job.result.outputWidth }}×{{ job.result.outputHeight }}</dd>
      </div>
      <div>
        <dt class="text-mist">Video</dt>
        <dd>{{ job.result.outputVideoCodec }}</dd>
      </div>
      <div>
        <dt class="text-mist">Audio</dt>
        <dd>{{ job.result.outputAudioCodec ?? 'None' }}</dd>
      </div>
      <div>
        <dt class="text-mist">Bitrate</dt>
        <dd>{{ formatBitrate(job.result.outputBitrate) }}</dd>
      </div>
    </dl>
    <p
      v-if="job.result.targetBytes != null"
      class="mt-4 text-sm"
      :class="job.result.targetMet ? 'text-mint' : 'text-amber'"
    >
      Budget {{ formatBytes(job.result.targetBytes) }}. {{ job.result.targetMessage }}
    </p>
    <div v-if="compare" class="mt-4 grid gap-3 md:grid-cols-2">
      <figure>
        <figcaption class="mb-2 text-xs uppercase tracking-wide text-mist">Original</figcaption>
        <video
          :src="job.result.inputPlaybackUrl"
          controls
          class="aspect-video w-full rounded-2xl"
        />
      </figure>
      <figure>
        <figcaption class="mb-2 text-xs uppercase tracking-wide text-mist">Compressed</figcaption>
        <video
          :src="job.result.outputPlaybackUrl"
          controls
          class="aspect-video w-full rounded-2xl"
        />
      </figure>
    </div>
    <div class="mt-4 flex flex-wrap gap-2">
      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-full bg-raised px-3 py-2 text-sm"
        @click="emit('reveal', job.result.outputPath)"
      >
        <FolderOpen class="h-4 w-4" /> Open folder
      </button>
      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-full bg-raised px-3 py-2 text-sm"
        @click="emit('play', job.result.outputPath)"
      >
        <Play class="h-4 w-4" /> Play
      </button>
      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-full bg-raised px-3 py-2 text-sm"
        @click="emit('save-copy', job.result.outputPath)"
      >
        <Save class="h-4 w-4" /> Save a copy
      </button>
      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-full bg-raised px-3 py-2 text-sm"
        @click="emit('compare')"
      >
        <Columns2 class="h-4 w-4" /> {{ compare ? 'Hide comparison' : 'Compare' }}
      </button>
      <button
        v-if="job.result.targetMet === false && job.retryCount < 1"
        type="button"
        class="inline-flex items-center gap-2 rounded-full bg-amber px-3 py-2 text-sm text-pine"
        @click="emit('retry', job.id)"
      >
        <RotateCcw class="h-4 w-4" /> Retry once with a lower bitrate
      </button>
      <button
        type="button"
        class="rounded-full bg-mint px-3 py-2 text-sm font-semibold text-pine"
        @click="emit('another')"
      >
        Compress another
      </button>
    </div>
    <p class="mt-3 text-xs text-mist">
      Elapsed clock in the progress view was {{ formatClock(job.result.encodingDurationSeconds) }}.
    </p>
  </section>
</template>
