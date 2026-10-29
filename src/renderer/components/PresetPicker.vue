<script setup lang="ts">
import { PRESET_LIST } from '../../shared/presets'
import type { PresetId } from '../../shared/types'

defineProps<{ modelValue: PresetId }>()
const emit = defineEmits<{ select: [id: Exclude<PresetId, 'custom'>] }>()
</script>

<template>
  <section class="rounded-3xl border border-stroke bg-panel p-5">
    <h2 class="text-sm font-semibold uppercase tracking-[0.16em] text-mist">Presets</h2>
    <div class="mt-4 grid gap-2">
      <button
        v-for="preset in PRESET_LIST"
        :key="preset.id"
        type="button"
        class="rounded-2xl border px-3 py-3 text-left transition"
        :class="
          modelValue === preset.id
            ? 'border-mint bg-pine/40'
            : 'border-stroke bg-raised hover:border-mist'
        "
        @click="emit('select', preset.id)"
      >
        <span class="flex items-center justify-between gap-3">
          <span class="font-semibold">{{ preset.label }}</span>
          <span class="text-xs text-mist">CRF {{ preset.crf }}</span>
        </span>
        <span class="mt-1 block text-sm leading-5 text-mist">{{ preset.description }}</span>
      </button>
    </div>
  </section>
</template>
