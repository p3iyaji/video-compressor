/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PresetPicker from '../../src/renderer/components/PresetPicker.vue'
import ResultsPanel from '../../src/renderer/components/ResultsPanel.vue'
import type { JobSnapshot } from '../../src/shared/types'
import { balancedSettings, mediaFixture, resultFor } from '../helpers/fixtures'

function job(overrides: Partial<JobSnapshot> = {}): JobSnapshot {
  const media = mediaFixture()
  const base: JobSnapshot = {
    id: 'job-1',
    status: 'completed',
    inputPath: media.path,
    inputName: media.fileName,
    inputPlaybackUrl: 'media://local/input',
    outputPlaybackUrl: 'media://local/output',
    outputPath: '/videos/out.mp4',
    outputDirectory: '/videos',
    settings: balancedSettings(),
    createdAt: '2026-01-01T00:00:00.000Z',
    warnings: [],
    retryCount: 0,
    sourceSizeBytes: media.fileSizeBytes,
    presetLabel: 'Balanced',
    settingsSummary: 'Balanced',
    overwrite: false,
    ...overrides
  }
  return base
}

describe('compressor components', () => {
  it('selects a preset', async () => {
    const wrapper = mount(PresetPicker, { props: { modelValue: 'balanced' } })
    const high = wrapper.findAll('button').find((button) => button.text().includes('High Quality'))
    expect(high).toBeTruthy()
    await high!.trigger('click')
    expect(wrapper.emitted('select')?.at(-1)).toEqual(['high'])
  })

  it('shows a negative space saving when the output grows', () => {
    const completed = job()
    completed.result = resultFor(completed, completed.sourceSizeBytes + 50_000_000)
    const wrapper = mount(ResultsPanel, { props: { job: completed, compare: false } })
    expect(wrapper.text()).toContain('-')
    expect(wrapper.text()).toContain('larger than the original')
    expect(wrapper.text()).toContain('Output verified')
  })
})
