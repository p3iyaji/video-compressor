<script setup lang="ts">
import { computed } from 'vue'
import type { CompressionSettings, EncoderAvailability, MediaInfo } from '../../shared/types'
import { AUDIO_BITRATES, ENCODER_IDS, X264_PRESETS } from '../../shared/types'

const props = defineProps<{
  settings: CompressionSettings
  media: MediaInfo | null
  encoders: EncoderAvailability | null
}>()
const emit = defineEmits<{ change: [patch: Partial<CompressionSettings>] }>()

const encoderChoices = computed(() =>
  ENCODER_IDS.map((id) => ({
    id,
    label:
      id === 'libx264'
        ? 'Software (libx264)'
        : id === 'h264_videotoolbox'
          ? 'Apple VideoToolbox'
          : id === 'h264_nvenc'
            ? 'NVIDIA NVENC'
            : 'Intel Quick Sync',
    available: props.encoders?.encoders.includes(id) ?? false
  }))
)

function eventValue(event: Event): string {
  const target = event.target
  if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return target.value
  return ''
}

function resolutionMode(value: string): void {
  if (value === 'original') emit('change', { resolution: { mode: 'original' } })
  else if (value === 'custom')
    emit('change', { resolution: { mode: 'custom', width: 1280, height: 720 } })
  else if (value === '2160' || value === '1440' || value === '1080' || value === '720') {
    const height = Number(value) as 2160 | 1440 | 1080 | 720
    emit('change', { resolution: { mode: 'height', height } })
  }
}

function onWidth(event: Event): void {
  if (props.settings.resolution.mode !== 'custom') return
  emit('change', {
    resolution: {
      mode: 'custom',
      width: Number(eventValue(event)),
      height: props.settings.resolution.height
    }
  })
}

function onHeight(event: Event): void {
  if (props.settings.resolution.mode !== 'custom') return
  emit('change', {
    resolution: {
      mode: 'custom',
      width: props.settings.resolution.width,
      height: Number(eventValue(event))
    }
  })
}

function onCrf(event: Event): void {
  emit('change', { rateControl: { mode: 'crf', crf: Number(eventValue(event)) } })
}

function onSpeed(event: Event): void {
  const value = eventValue(event)
  if ((X264_PRESETS as readonly string[]).includes(value)) {
    emit('change', { x264Preset: value as CompressionSettings['x264Preset'] })
  }
}

function onAudioMode(event: Event): void {
  const value = eventValue(event)
  if (value === 'aac' || value === 'copy' || value === 'remove')
    emit('change', { audioMode: value })
}

function onAudioRate(event: Event): void {
  const value = Number(eventValue(event))
  if ((AUDIO_BITRATES as readonly number[]).includes(value)) {
    emit('change', { audioBitrateKbps: value as CompressionSettings['audioBitrateKbps'] })
  }
}

function onFrameRate(event: Event): void {
  const value = eventValue(event)
  if (value === 'original') emit('change', { frameRate: { mode: 'original' } })
  else if (value === '30') emit('change', { frameRate: { mode: 'value', fps: 30 } })
  else emit('change', { frameRate: { mode: 'value', fps: 24 } })
}

function onCustomFps(event: Event): void {
  emit('change', { frameRate: { mode: 'value', fps: Number(eventValue(event)) } })
}

function onFastStart(event: Event): void {
  emit('change', { fastStart: event.target instanceof HTMLInputElement && event.target.checked })
}
</script>

<template>
  <section class="rounded-3xl border border-stroke bg-panel p-5">
    <h2 class="text-sm font-semibold uppercase tracking-[0.16em] text-mist">Custom settings</h2>
    <div class="mt-4 grid gap-3">
      <label class="grid gap-1 text-sm">
        <span class="text-mist">Resolution</span>
        <select
          class="rounded-xl border border-stroke bg-canvas px-3 py-2"
          :value="
            settings.resolution.mode === 'height'
              ? String(settings.resolution.height)
              : settings.resolution.mode
          "
          @change="resolutionMode(eventValue($event))"
        >
          <option value="original">Original</option>
          <option value="2160">2160p</option>
          <option value="1440">1440p</option>
          <option value="1080">1080p</option>
          <option value="720">720p</option>
          <option value="custom">Custom frame</option>
        </select>
      </label>
      <div v-if="settings.resolution.mode === 'custom'" class="grid grid-cols-2 gap-2">
        <label class="grid gap-1 text-sm">
          <span class="text-mist">Width</span>
          <input
            class="rounded-xl border border-stroke bg-canvas px-3 py-2"
            type="number"
            min="16"
            max="7680"
            :value="settings.resolution.width"
            @change="onWidth"
          />
        </label>
        <label class="grid gap-1 text-sm">
          <span class="text-mist">Height</span>
          <input
            class="rounded-xl border border-stroke bg-canvas px-3 py-2"
            type="number"
            min="16"
            max="7680"
            :value="settings.resolution.height"
            @change="onHeight"
          />
        </label>
      </div>
      <p class="text-xs leading-5 text-mist">
        Output is fitted inside the frame you pick. A smaller source is never upscaled, and the
        picture is not stretched.
      </p>
      <label v-if="settings.rateControl.mode === 'crf'" class="grid gap-1 text-sm">
        <span class="text-mist"
          >CRF {{ settings.rateControl.crf }} · lower keeps more detail and uses more space</span
        >
        <input
          :value="settings.rateControl.crf"
          type="range"
          min="0"
          max="51"
          step="1"
          @input="onCrf"
        />
      </label>
      <label class="grid gap-1 text-sm">
        <span class="text-mist">Encoding speed</span>
        <select
          class="rounded-xl border border-stroke bg-canvas px-3 py-2"
          :value="settings.x264Preset"
          @change="onSpeed"
        >
          <option v-for="preset in X264_PRESETS" :key="preset" :value="preset">{{ preset }}</option>
        </select>
      </label>
      <label class="grid gap-1 text-sm">
        <span class="text-mist">Audio</span>
        <select
          class="rounded-xl border border-stroke bg-canvas px-3 py-2"
          :value="settings.audioMode"
          @change="onAudioMode"
        >
          <option value="aac">Convert to AAC</option>
          <option value="copy">Keep compatible AAC</option>
          <option value="remove">Remove audio</option>
        </select>
      </label>
      <label v-if="settings.audioMode === 'aac'" class="grid gap-1 text-sm">
        <span class="text-mist">Audio bitrate</span>
        <select
          class="rounded-xl border border-stroke bg-canvas px-3 py-2"
          :value="settings.audioBitrateKbps"
          @change="onAudioRate"
        >
          <option v-for="rate in AUDIO_BITRATES" :key="rate" :value="rate">{{ rate }} kbps</option>
        </select>
      </label>
      <label class="grid gap-1 text-sm">
        <span class="text-mist">Frame rate</span>
        <select
          class="rounded-xl border border-stroke bg-canvas px-3 py-2"
          :value="
            settings.frameRate.mode === 'original'
              ? 'original'
              : settings.frameRate.fps === 30
                ? '30'
                : 'custom'
          "
          @change="onFrameRate"
        >
          <option value="original">Original</option>
          <option value="30">30 fps</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      <label v-if="settings.frameRate.mode === 'value'" class="grid gap-1 text-sm">
        <span class="text-mist">Custom fps</span>
        <input
          class="rounded-xl border border-stroke bg-canvas px-3 py-2"
          type="number"
          min="1"
          max="120"
          step="0.001"
          :value="settings.frameRate.fps"
          @change="onCustomFps"
        />
      </label>
      <label class="flex items-center gap-2 text-sm">
        <input :checked="settings.fastStart" type="checkbox" @change="onFastStart" />
        Fast start (move metadata so playback can begin sooner)
      </label>
      <fieldset class="grid gap-2">
        <legend class="text-sm text-mist">Encoder</legend>
        <label
          v-for="choice in encoderChoices"
          :key="choice.id"
          class="flex items-start gap-2 text-sm"
        >
          <input
            :checked="settings.encoder === choice.id"
            :disabled="!choice.available"
            type="radio"
            name="encoder"
            @change="emit('change', { encoder: choice.id })"
          />
          <span>
            <span class="font-medium">{{ choice.label }}</span>
            <span v-if="!choice.available" class="text-mist"> · not in this FFmpeg build</span>
          </span>
        </label>
      </fieldset>
      <p v-if="!media" class="text-xs text-mist">Choose a video to calculate a size estimate.</p>
    </div>
  </section>
</template>
