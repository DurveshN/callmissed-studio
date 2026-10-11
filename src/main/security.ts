import { app, session, shell, type WebFrameMain } from 'electron'
import { APP_ORIGIN } from './app-protocol'

const devServerUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']

/** Origin the renderer is legitimately loaded from (dev server or studio://app). */
export function rendererOrigin(): string {
  return devServerUrl ? new URL(devServerUrl).origin : APP_ORIGIN
}

/** Compares scheme + host; URL.origin is "null" for custom schemes in Node, so it can't be used. */
export function isTrustedUrl(url: string): boolean {
  try {
    const target = new URL(url)
    const trusted = new URL(rendererOrigin())
    return target.protocol === trusted.protocol && target.host === trusted.host
  } catch {
    return false
  }
}

export function isTrustedSender(frame: WebFrameMain | null): boolean {
  return frame !== null && isTrustedUrl(frame.url)
}

/** Applies app-wide hardening: no navigation, no popups, no webviews, no permissions. */
export function applySecurityPolicies(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      if (!isTrustedUrl(url)) event.preventDefault()
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
    contents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://')) void shell.openExternal(url)
      return { action: 'deny' }
    })
  })

  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
}
