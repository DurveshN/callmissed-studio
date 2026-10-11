/// <reference types="vite/client" />
import type { StudioApi } from '@shared/ipc/api'

declare global {
  interface Window {
    studio: StudioApi
  }
}
