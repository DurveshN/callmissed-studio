import { contextBridge, ipcRenderer } from 'electron'
import type { StudioApi } from '@shared/ipc/api'
import { isChannel } from '@shared/ipc/channels'

const api: StudioApi = {
  invoke(channel, input) {
    // Only channels declared in the shared contracts may cross the bridge.
    if (!isChannel(channel)) {
      return Promise.resolve({
        ok: false,
        error: { code: 'UNKNOWN_CHANNEL', message: `Unknown channel: ${String(channel)}` }
      })
    }
    return ipcRenderer.invoke(channel, input)
  }
}

contextBridge.exposeInMainWorld('studio', api)
