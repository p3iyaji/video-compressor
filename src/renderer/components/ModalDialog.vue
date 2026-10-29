<script setup lang="ts">
defineProps<{ title: string; message: string }>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()
</script>

<template>
  <div class="fixed inset-0 z-20 grid place-items-center bg-black/60 px-4">
    <div
      class="w-full max-w-lg rounded-3xl border border-stroke bg-panel p-6"
      role="dialog"
      aria-modal="true"
    >
      <h2 class="text-lg font-semibold">{{ title }}</h2>
      <p class="mt-2 text-sm leading-6 text-mist">{{ message }}</p>
      <div class="mt-5 flex justify-end gap-2">
        <button
          type="button"
          class="rounded-full border border-stroke px-4 py-2 text-sm"
          @click="emit('cancel')"
        >
          Go back
        </button>
        <button
          type="button"
          class="rounded-full bg-mint px-4 py-2 text-sm font-semibold text-pine"
          @click="emit('confirm')"
        >
          Continue
        </button>
      </div>
    </div>
  </div>
</template>
