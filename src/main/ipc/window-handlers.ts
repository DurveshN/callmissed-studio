import { confirmClose, markRendererReady, setDirty } from '../window'
import { handle } from './router'

export function registerWindowHandlers(): void {
  handle('window:set-dirty', ({ dirty }, { window }) => {
    if (window) setDirty(window, dirty)
  })
  handle('window:close-confirmed', (_input, { window }) => {
    if (window) confirmClose(window)
  })
  handle('window:renderer-ready', (_input, { window }) => {
    if (window) markRendererReady(window)
  })
}
