<script setup lang="ts">
import type { CompressionEstimate } from '../../shared/types'

defineProps<{ estimate: CompressionEstimate }>()
</script>

<template>
  <section class="rounded-3xl border border-stroke bg-panel p-5">
    <h2 class="text-sm font-semibold uppercase tracking-[0.16em] text-mist">Before export</h2>
    <dl class="mt-4 grid gap-2 text-sm">
      <div class="flex justify-between gap-4">
        <dt class="text-mist">Resolution</dt>
        <dd>{{ estimate.summary.resolution }}</dd>
      </div>
      <div class="flex justify-between gap-4">
        <dt class="text-mist">Frame rate</dt>
        <dd>{{ estimate.summary.frameRate }}</dd>
      </div>
      <div class="flex justify-between gap-4">
        <dt class="text-mist">Video</dt>
        <dd>{{ estimate.summary.videoCodec }}</dd>
      </div>
      <div class="flex justify-between gap-4">
        <dt class="text-mist">Audio</dt>
        <dd>{{ estimate.summary.audioCodec }}</dd>
      </div>
      <div class="flex justify-between gap-4">
        <dt class="text-mist">Quality</dt>
        <dd>{{ estimate.summary.quality }}</dd>
      </div>
      <div class="flex justify-between gap-4">
        <dt class="text-mist">Size</dt>
        <dd>{{ estimate.summary.estimatedSize }}</dd>
      </div>
      <div class="flex justify-between gap-4">
        <dt class="text-mist">Fast start</dt>
        <dd>{{ estimate.summary.fastStart ? 'Yes' : 'No' }}</dd>
      </div>
    </dl>
    <ul class="mt-4 grid gap-2 text-sm leading-5 text-mist">
      <li v-for="note in estimate.summary.tradeoffs" :key="note">{{ note }}</li>
    </ul>
    <div class="mt-4 grid gap-2">
      <p
        v-for="warning in estimate.warnings"
        :key="warning.message"
        class="rounded-2xl px-3 py-2 text-sm leading-5"
        :class="
          warning.level === 'danger'
            ? 'bg-coral/15 text-coral'
            : warning.level === 'warning'
              ? 'bg-amber/15 text-amber'
              : 'bg-raised text-mist'
        "
      >
        {{ warning.message }}
      </p>
    </div>
  </section>
</template>
