/// <reference types="vite/client" />

import type { CompressorApi } from '../shared/bridge'

declare global {
  interface Window {
    compressor: CompressorApi
  }
}

export {}
