<script setup lang="ts">
import { ref } from 'vue'
import type { RateControl } from '../../shared/types'
import { BYTES_PER_MB } from '../../shared/units'

const props = defineProps<{ rateControl: RateControl }>()
const emit = defineEmits<{
  'use-quality': []
  'set-target': [bytes: number]
  'set-custom': [value: number, unit: 'MB' | 'GB']
  'set-two-pass': [enabled: boolean]
}>()

const targets = [100, 250, 500, 700, 900]
const customValue = ref(250)
const customUnit = ref<'MB' | 'GB'>('MB')

function selected(bytes: number): boolean {
  return props.rateControl.mode === 'size' && props.rateControl.targetBytes === bytes * BYTES_PER_MB
}

function onTwoPass(event: Event): void {
  emit('set-two-pass', event.target instanceof HTMLInputElement && event.target.checked)
}
</script>

<template>
  <section class="rounded-3xl border border-stroke bg-panel p-5">
    <div class="flex items-start justify-between gap-3">
      <div>
        <h2 class="text-sm font-semibold uppercase tracking-[0.16em] text-mist">Target size</h2>
        <p class="mt-2 text-sm leading-5 text-mist">
          This is a maximum budget, not a promise of an exact byte count. Audio and a small
          container allowance are reserved before the video bitrate is calculated.
        </p>
      </div>
      <button
        type="button"
        class="shrink-0 rounded-full border border-stroke px-3 py-1 text-xs"
        @click="emit('use-quality')"
      >
        Use CRF
      </button>
    </div>
    <div class="mt-4 flex flex-wrap gap-2">
      <button
        v-for="size in targets"
        :key="size"
        type="button"
        class="rounded-full px-3 py-1 text-sm"
        :class="selected(size) ? 'bg-mint text-pine' : 'bg-raised text-foam'"
        @click="emit('set-target', size * BYTES_PER_MB)"
      >
        {{ size }} MB
      </button>
    </div>
    <form class="mt-4 flex gap-2" @submit.prevent="emit('set-custom', customValue, customUnit)">
      <input
        v-model.number="customValue"
        aria-label="Custom target size"
        class="w-full rounded-xl border border-stroke bg-canvas px-3 py-2"
        min="0.1"
        step="0.1"
        type="number"
      />
      <select
        v-model="customUnit"
        aria-label="Target unit"
        class="rounded-xl border border-stroke bg-canvas px-3"
      >
        <option>MB</option>
        <option>GB</option>
      </select>
      <button type="submit" class="rounded-xl bg-raised px-3 text-sm">Set</button>
    </form>
    <label v-if="rateControl.mode === 'size'" class="mt-4 flex items-center gap-2 text-sm">
      <input :checked="rateControl.twoPass" type="checkbox" @change="onTwoPass" />
      Two-pass H.264 for a closer file size
    </label>
  </section>
</template>
