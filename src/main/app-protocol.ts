import { join, normalize, relative, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'

export const APP_SCHEME = 'studio'
export const APP_ORIGIN = `${APP_SCHEME}://app`

/** Must run before app 'ready'. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ])
}

/**
 * Maps a studio://app/<path> URL to a file inside rootDir.
 * Returns null for other hosts or for paths escaping rootDir.
 */
export function resolveAppAsset(rootDir: string, requestUrl: string): string | null {
  const url = new URL(requestUrl)
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== 'app') return null
  const pathname = decodeURIComponent(url.pathname)
  const target = normalize(join(rootDir, pathname === '/' ? 'index.html' : pathname))
  const rel = relative(rootDir, target)
  if (rel.startsWith('..') || isAbsolute(rel)) return null
  return target
}

/** Serves the built renderer from rootDir over studio://app (avoids file:// privileges). */
export function serveAppProtocol(rootDir: string): void {
  protocol.handle(APP_SCHEME, (request) => {
    const file = resolveAppAsset(rootDir, request.url)
    if (!file) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })
}
