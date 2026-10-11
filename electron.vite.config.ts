import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { contentSecurityPolicy } from './src/shared/csp'

const shared = resolve(__dirname, 'src/shared')

/** Injects the CSP meta tag; dev and build get different policies. */
function csp(): Plugin {
  let isDev = false
  return {
    name: 'studio-csp',
    configResolved(config) {
      isDev = config.command === 'serve'
    },
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: contentSecurityPolicy(isDev) },
        injectTo: 'head-prepend'
      }
    ]
  }
}

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } }
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
    // Sandboxed preloads cannot require node_modules, so everything is bundled.
    build: { externalizeDeps: false }
  },
  renderer: {
    resolve: {
      alias: {
        '@shared': shared,
        '@renderer': resolve(__dirname, 'src/renderer/src')
      }
    },
    plugins: [react(), csp()]
  }
})
