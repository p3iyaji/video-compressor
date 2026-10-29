<script setup lang="ts">
import type { JobSnapshot } from '../../shared/types'
import { formatBytes } from '../../shared/units'

defineProps<{ jobs: JobSnapshot[]; activeId: string | null }>()
const emit = defineEmits<{ open: [id: string]; cancel: [id: string]; clear: [] }>()
</script>

<template>
  <section class="rounded-3xl border border-stroke bg-panel p-5">
    <div class="flex items-center justify-between gap-3">
      <div>
        <h2 class="font-semibold">Queue</h2>
        <p class="text-sm text-mist">
          One encode runs at a time so the machine stays usable. An interrupted encode has to start
          over.
        </p>
      </div>
      <button
        type="button"
        class="rounded-full border border-stroke px-3 py-1 text-sm"
        @click="emit('clear')"
      >
        Clear finished
      </button>
    </div>
    <p v-if="jobs.length === 0" class="mt-4 text-sm text-mist">No jobs yet.</p>
    <ul v-else class="mt-4 divide-y divide-stroke">
      <li v-for="job in jobs" :key="job.id" class="flex items-center justify-between gap-3 py-3">
        <button type="button" class="min-w-0 text-left" @click="emit('open', job.id)">
          <span
            class="block truncate font-medium"
            :class="activeId === job.id ? 'text-mint' : ''"
            >{{ job.inputName }}</span
          >
          <span class="block text-xs text-mist"
            >{{ job.status }} · {{ formatBytes(job.sourceSizeBytes) }} · {{ job.presetLabel }}</span
          >
        </button>
        <button
          v-if="job.status === 'queued' || job.status === 'running' || job.status === 'verifying'"
          type="button"
          class="text-sm text-coral"
          @click="emit('cancel', job.id)"
        >
          Cancel
        </button>
      </li>
    </ul>
  </section>
</template>
