import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { StudioApi } from '@shared/ipc/api'
import { isAppEvent, isChannel } from '@shared/ipc/channels'

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
  },
  on(event, listener) {
    if (!isAppEvent(event)) throw new Error(`Unknown event: ${String(event)}`)
    // Never hand the raw IpcRendererEvent (which exposes `sender`) to the page.
    const wrapped = (_e: IpcRendererEvent, payload: Parameters<typeof listener>[0]) => listener(payload)
    ipcRenderer.on(event, wrapped)
    return () => ipcRenderer.removeListener(event, wrapped)
  },
  pathForFile(file) {
    return webUtils.getPathForFile(file)
  }
}

contextBridge.exposeInMainWorld('studio', api)
