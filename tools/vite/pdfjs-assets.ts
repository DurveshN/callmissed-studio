import { cpSync, createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, relative, resolve } from 'node:path'
import type { Plugin } from 'vite'

/** pdf.js runtime data served at /pdfjs/<dir>/… (CMaps, standard fonts, wasm decoders, ICC profiles). */
const DIRS = ['cmaps', 'standard_fonts', 'wasm', 'iccs']
const TYPES: Record<string, string> = { '.wasm': 'application/wasm' }

export function pdfjsAssets(root: string): Plugin {
  const source = resolve(root, 'node_modules/pdfjs-dist')
  let outDir = ''
  return {
    name: 'studio-pdfjs-assets',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    configureServer(server) {
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const path = normalize(join(source, decodeURIComponent((req.url ?? '').split('?')[0] ?? '')))
        const rel = relative(source, path)
        const inAllowedDir = DIRS.some((d) => rel.startsWith(d + '\\') || rel.startsWith(d + '/'))
        if (!inAllowedDir || !existsSync(path) || !statSync(path).isFile()) return next()
        res.setHeader('Content-Type', TYPES[extname(path)] ?? 'application/octet-stream')
        createReadStream(path).pipe(res)
      })
    },
    writeBundle() {
      for (const dir of DIRS) cpSync(join(source, dir), join(outDir, 'pdfjs', dir), { recursive: true })
    }
  }
}
