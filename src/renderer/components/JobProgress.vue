<script setup lang="ts">
import { Ban } from '@lucide/vue'
import type { JobSnapshot } from '../../shared/types'
import { formatBytes, formatClock, formatSpeed } from '../../shared/units'

defineProps<{ job: JobSnapshot }>()
const emit = defineEmits<{ cancel: [id: string] }>()
</script>

<template>
  <section class="rounded-3xl border border-stroke bg-panel p-5" aria-live="polite">
    <div class="flex items-start justify-between gap-3">
      <div>
        <h2 class="font-semibold">
          {{ job.status === 'verifying' ? 'Checking the output' : 'Compressing' }}
        </h2>
        <p class="mt-1 text-sm text-mist">{{ job.inputName }} · {{ job.settingsSummary }}</p>
      </div>
      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-full border border-stroke px-3 py-1 text-sm"
        @click="emit('cancel', job.id)"
      >
        <Ban class="h-4 w-4" />
        Cancel
      </button>
    </div>
    <div
      class="mt-4 h-2 overflow-hidden rounded-full bg-raised"
      role="progressbar"
      :aria-valuenow="job.progress?.percent ?? undefined"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <div
        class="h-full bg-mint transition-all"
        :class="job.progress?.indeterminate ? 'w-1/3 animate-pulse' : ''"
        :style="
          job.progress?.percent != null
            ? { width: `${Math.max(2, job.progress.percent)}%` }
            : undefined
        "
      />
    </div>
    <dl class="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
      <div>
        <dt class="text-mist">Progress</dt>
        <dd>
          {{ job.progress?.percent == null ? 'Working' : `${job.progress.percent.toFixed(0)}%` }}
        </dd>
      </div>
      <div>
        <dt class="text-mist">Elapsed</dt>
        <dd>{{ formatClock(job.progress?.elapsedSeconds) }}</dd>
      </div>
      <div>
        <dt class="text-mist">Remaining</dt>
        <dd>{{ formatClock(job.progress?.etaSeconds) }}</dd>
      </div>
      <div>
        <dt class="text-mist">Speed</dt>
        <dd>{{ formatSpeed(job.progress?.speed) }}</dd>
      </div>
      <div>
        <dt class="text-mist">Source</dt>
        <dd>{{ formatBytes(job.sourceSizeBytes) }}</dd>
      </div>
      <div>
        <dt class="text-mist">Output so far</dt>
        <dd>{{ formatBytes(job.progress?.outputSizeBytes) }}</dd>
      </div>
      <div>
        <dt class="text-mist">Pass</dt>
        <dd>{{ job.progress ? `${job.progress.passIndex} of ${job.progress.passCount}` : '—' }}</dd>
      </div>
      <div>
        <dt class="text-mist">Preset</dt>
        <dd>{{ job.presetLabel }}</dd>
      </div>
    </dl>
    <p v-if="job.progress?.indeterminate" class="mt-3 text-sm text-mist">
      A percentage is hidden because this file has no reliable duration.
    </p>
  </section>
</template>
