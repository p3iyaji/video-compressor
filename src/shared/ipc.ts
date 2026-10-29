export const channels = {
  selectInput: 'media:select-input',
  authorizeDropped: 'media:authorize-dropped',
  selectOutputDirectory: 'media:select-output-directory',
  getEncoders: 'ffmpeg:encoders',
  locateFfmpeg: 'ffmpeg:locate',
  checkDisk: 'system:check-disk',
  startJob: 'jobs:start',
  retryJob: 'jobs:retry',
  cancelJob: 'jobs:cancel',
  listJobs: 'jobs:list',
  clearFinished: 'jobs:clear-finished',
  reveal: 'shell:reveal',
  openPath: 'shell:open',
  saveCopy: 'shell:save-copy',
  jobEvent: 'jobs:event'
} as const
