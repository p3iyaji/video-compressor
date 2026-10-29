import type {
  AuthorizedMedia,
  DiskAssessment,
  EncoderAvailability,
  JobEvent,
  JobSnapshot,
  StartJobPayload,
  StartJobResult
} from './types'

export interface CompressorApi {
  pathForFile: (file: File) => string
  selectInput: () => Promise<AuthorizedMedia[]>
  authorizeDropped: (filePath: string) => Promise<AuthorizedMedia>
  selectOutputDirectory: () => Promise<string | null>
  getEncoders: () => Promise<EncoderAvailability>
  locateFfmpeg: () => Promise<EncoderAvailability>
  checkDisk: (
    directory: string,
    estimatedBytes: number | null,
    sourceBytes: number
  ) => Promise<DiskAssessment>
  startJob: (payload: StartJobPayload) => Promise<StartJobResult>
  retryJob: (jobId: string) => Promise<StartJobResult>
  cancelJob: (jobId: string) => Promise<JobSnapshot[]>
  listJobs: () => Promise<JobSnapshot[]>
  clearFinished: () => Promise<JobSnapshot[]>
  reveal: (filePath: string) => Promise<boolean>
  openPath: (filePath: string) => Promise<boolean>
  saveCopy: (filePath: string) => Promise<string | null>
  onJobEvent: (callback: (event: JobEvent) => void) => () => void
}
