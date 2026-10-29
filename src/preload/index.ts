import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { CompressorApi } from '../shared/bridge'
import { channels } from '../shared/ipc'
import type { JobEvent } from '../shared/types'

function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const api: CompressorApi = {
  pathForFile: (file) => webUtils.getPathForFile(file),
  selectInput: () => ipcRenderer.invoke(channels.selectInput),
  authorizeDropped: (filePath) => ipcRenderer.invoke(channels.authorizeDropped, filePath),
  selectOutputDirectory: () => ipcRenderer.invoke(channels.selectOutputDirectory),
  getEncoders: () => ipcRenderer.invoke(channels.getEncoders),
  locateFfmpeg: () => ipcRenderer.invoke(channels.locateFfmpeg),
  checkDisk: (directory, estimatedBytes, sourceBytes) =>
    ipcRenderer.invoke(channels.checkDisk, directory, estimatedBytes, sourceBytes),
  startJob: (payload) => ipcRenderer.invoke(channels.startJob, plain(payload)),
  retryJob: (jobId) => ipcRenderer.invoke(channels.retryJob, jobId),
  cancelJob: (jobId) => ipcRenderer.invoke(channels.cancelJob, jobId),
  listJobs: () => ipcRenderer.invoke(channels.listJobs),
  clearFinished: () => ipcRenderer.invoke(channels.clearFinished),
  reveal: (filePath) => ipcRenderer.invoke(channels.reveal, filePath),
  openPath: (filePath) => ipcRenderer.invoke(channels.openPath, filePath),
  saveCopy: (filePath) => ipcRenderer.invoke(channels.saveCopy, filePath),
  onJobEvent: (callback) => {
    const listener = (_event: unknown, payload: JobEvent) => callback(payload)
    ipcRenderer.on(channels.jobEvent, listener)
    return () => ipcRenderer.removeListener(channels.jobEvent, listener)
  }
}

contextBridge.exposeInMainWorld('compressor', api)
