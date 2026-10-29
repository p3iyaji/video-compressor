<script setup lang="ts">
import { Film, FolderOpen } from '@lucide/vue'

defineProps<{ fileName: string | null }>()
const emit = defineEmits<{ browse: []; drop: [files: File[]] }>()

function onDrop(event: DragEvent): void {
  const files = Array.from(event.dataTransfer?.files ?? [])
  if (files.length > 0) emit('drop', files)
}
</script>

<template>
  <section
    class="rounded-3xl border border-dashed border-stroke bg-panel px-6 py-8 text-center"
    @dragover.prevent
    @drop.prevent="onDrop"
  >
    <div class="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-raised text-mint">
      <Film class="h-7 w-7" />
    </div>
    <h2 class="text-xl font-semibold tracking-tight">
      {{ fileName ? fileName : 'Drop an MP4 to compress it locally' }}
    </h2>
    <p class="mx-auto mt-2 max-w-xl text-sm leading-6 text-mist">
      Files stay on this computer. A 1 GB video is read by FFmpeg as a stream, not loaded into the
      window.
    </p>
    <button
      type="button"
      class="mt-5 inline-flex items-center gap-2 rounded-full bg-mint px-4 py-2 text-sm font-semibold text-pine"
      @click="emit('browse')"
    >
      <FolderOpen class="h-4 w-4" />
      Browse MP4 files
    </button>
  </section>
</template>
