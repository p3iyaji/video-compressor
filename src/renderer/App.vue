<script setup lang="ts">
import { Film, HardDrive, Shield } from '@lucide/vue'
import { computed } from 'vue'
import AdvancedSettings from './components/AdvancedSettings.vue'
import DropZone from './components/DropZone.vue'
import JobProgress from './components/JobProgress.vue'
import MediaInfoPanel from './components/MediaInfoPanel.vue'
import ModalDialog from './components/ModalDialog.vue'
import PresetPicker from './components/PresetPicker.vue'
import QueueList from './components/QueueList.vue'
import ResultsPanel from './components/ResultsPanel.vue'
import SummaryCard from './components/SummaryCard.vue'
import TargetSizePanel from './components/TargetSizePanel.vue'
import { useCompressor } from './composables/useCompressor'

const compressor = useCompressor()
const hasApi = typeof window !== 'undefined' && 'compressor' in window
const blocked = computed(() => {
  if (!compressor.source.value) return 'Choose an MP4 first.'
  if (!compressor.encoders.value) return 'Checking FFmpeg…'
  if (!compressor.encoders.value.libx264 && compressor.settings.value.encoder === 'libx264') {
    return 'Install FFmpeg with libx264 before compressing.'
  }
  if (
    compressor.settings.value.rateControl.mode === 'size' &&
    compressor.estimate.value?.confidence === 'unavailable'
  ) {
    return compressor.estimate.value.warnings[0]?.message ?? 'That target size cannot be encoded.'
  }
  if (compressor.disk.value && !compressor.disk.value.ok) return compressor.disk.value.warning
  return null
})
function onOutputName(event: Event): void {
  if (!(event.target instanceof HTMLInputElement)) return
  compressor.filenameTouched.value = true
  compressor.settings.value = {
    ...compressor.settings.value,
    outputFileName: event.target.value
  }
}

const failure = computed(() => {
  const job = compressor.focusedJob.value
  if (!job?.error || compressor.dismissed.value.has(job.id)) return null
  if (job.status === 'failed' || job.status === 'cancelled' || job.status === 'interrupted')
    return job.error
  return null
})
</script>

<template>
  <div v-if="!hasApi" class="p-8">Open Smart MP4 Compressor in the desktop window.</div>
  <div v-else class="mx-auto min-h-screen max-w-7xl px-5 py-6">
    <header class="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div class="flex items-center gap-3">
        <div class="grid h-11 w-11 place-items-center rounded-2xl bg-mint text-pine">
          <Film class="h-6 w-6" />
        </div>
        <div>
          <h1 class="text-2xl font-semibold tracking-tight">Smart MP4 Compressor</h1>
          <p class="text-sm text-mist">
            Shrink large MP4 files for sharing. Encoding happens only on this computer.
          </p>
        </div>
      </div>
      <div class="flex items-center gap-2 text-sm">
        <span
          class="inline-flex items-center gap-2 rounded-full border border-stroke px-3 py-1 text-mist"
        >
          <Shield class="h-4 w-4 text-mint" /> Local only
        </span>
        <span class="inline-flex items-center gap-2 rounded-full border border-stroke px-3 py-1">
          <HardDrive class="h-4 w-4" />
          {{ compressor.encoders.value?.libx264 ? 'FFmpeg ready' : 'FFmpeg missing' }}
        </span>
      </div>
    </header>

    <p
      v-if="compressor.banner.value"
      class="mb-4 rounded-2xl border border-stroke bg-panel px-4 py-3 text-sm"
      :class="
        compressor.banner.value.tone === 'danger'
          ? 'text-coral'
          : compressor.banner.value.tone === 'warning'
            ? 'text-amber'
            : 'text-mist'
      "
    >
      {{ compressor.banner.value.message }}
      <button type="button" class="ml-3 underline" @click="compressor.dismissBanner()">
        Dismiss
      </button>
    </p>
    <p v-if="failure" class="mb-4 rounded-2xl bg-coral/15 px-4 py-3 text-sm text-coral">
      {{ failure }}
      <button type="button" class="ml-3 underline" @click="compressor.dismissBanner()">
        Clear
      </button>
    </p>
    <section
      v-if="compressor.encoders.value && !compressor.encoders.value.libx264"
      class="mb-4 rounded-3xl border border-amber/40 bg-panel p-5 text-sm leading-6"
    >
      <p class="font-semibold text-amber">
        FFmpeg with libx264 is required for the default encoder.
      </p>
      <p class="mt-2 text-mist">macOS: <code class="text-foam">brew install ffmpeg</code></p>
      <p class="text-mist">Windows: <code class="text-foam">winget install Gyan.FFmpeg</code></p>
      <p class="text-mist">
        Linux: install <code class="text-foam">ffmpeg</code> from your distribution, including
        libx264.
      </p>
      <button
        type="button"
        class="mt-3 rounded-full bg-mint px-3 py-1 text-pine"
        @click="compressor.locateFfmpeg()"
      >
        Locate FFmpeg
      </button>
    </section>

    <div class="grid items-start gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.8fr)]">
      <div class="grid gap-5">
        <DropZone
          :file-name="compressor.source.value?.info.fileName ?? null"
          @browse="compressor.browse()"
          @drop="compressor.onDrop($event)"
        />
        <MediaInfoPanel v-if="compressor.source.value" :media="compressor.source.value.info" />
        <SummaryCard v-if="compressor.estimate.value" :estimate="compressor.estimate.value" />
        <div class="rounded-3xl border border-stroke bg-panel p-5">
          <div class="grid gap-3 md:grid-cols-[1fr_auto]">
            <label class="grid gap-1 text-sm">
              <span class="text-mist">Output file</span>
              <input
                class="rounded-xl border border-stroke bg-canvas px-3 py-2"
                :value="compressor.settings.value.outputFileName"
                @input="onOutputName"
              />
            </label>
            <button
              type="button"
              class="self-end rounded-xl border border-stroke px-3 py-2 text-sm"
              @click="compressor.chooseOutputDirectory()"
            >
              Output folder
            </button>
          </div>
          <p class="mt-2 truncate text-xs text-mist">
            {{
              compressor.outputDirectory.value ||
              'The compressed file is saved next to the original unless you pick another folder.'
            }}
          </p>
          <p v-if="compressor.disk.value?.warning" class="mt-2 text-sm text-amber">
            {{ compressor.disk.value.warning }}
          </p>
          <button
            type="button"
            class="mt-4 rounded-full bg-mint px-5 py-2 text-sm font-semibold text-pine disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="Boolean(blocked)"
            @click="compressor.compress()"
          >
            Compress
          </button>
          <p v-if="blocked" class="mt-2 text-sm text-mist">{{ blocked }}</p>
        </div>
        <JobProgress
          v-if="compressor.runningJob.value"
          :job="compressor.runningJob.value"
          @cancel="compressor.cancel($event)"
        />
        <ResultsPanel
          v-if="compressor.focusedJob.value?.result"
          :job="compressor.focusedJob.value"
          :compare="compressor.compare.value"
          @reveal="compressor.reveal($event)"
          @play="compressor.play($event)"
          @save-copy="compressor.saveCopy($event)"
          @compare="compressor.compare.value = !compressor.compare.value"
          @retry="compressor.retry($event)"
          @another="compressor.compressAnother()"
        />
      </div>
      <div class="grid gap-5">
        <PresetPicker
          :model-value="compressor.settings.value.presetId"
          @select="compressor.applyPreset($event)"
        />
        <TargetSizePanel
          :rate-control="compressor.settings.value.rateControl"
          @use-quality="compressor.useQualityMode()"
          @set-target="compressor.setTargetBytes($event)"
          @set-custom="(value, unit) => compressor.setCustomTarget(value, unit)"
          @set-two-pass="
            compressor.settings.value = {
              ...compressor.settings.value,
              rateControl:
                compressor.settings.value.rateControl.mode === 'size'
                  ? { ...compressor.settings.value.rateControl, twoPass: $event }
                  : { mode: 'size', targetBytes: 250_000_000, twoPass: $event }
            }
          "
        />
        <AdvancedSettings
          :settings="compressor.settings.value"
          :media="compressor.source.value?.info ?? null"
          :encoders="compressor.encoders.value"
          @change="compressor.patchSettings($event)"
        />
      </div>
    </div>
    <div class="mt-5">
      <QueueList
        :jobs="compressor.jobs.value"
        :active-id="compressor.focusedJob.value?.id ?? null"
        @open="compressor.focusJob($event)"
        @cancel="compressor.cancel($event)"
        @clear="compressor.clearFinished()"
      />
    </div>
    <ModalDialog
      v-if="compressor.modal.value"
      :title="
        compressor.modal.value.kind === 'overwrite'
          ? 'Replace the existing file?'
          : 'This target will look poor'
      "
      :message="compressor.modal.value.message"
      @cancel="compressor.modal.value = null"
      @confirm="compressor.confirmModal()"
    />
  </div>
</template>
