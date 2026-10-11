import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

export function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `studio-${prefix}-`))
}

/** Launches the built app with an isolated profile. */
export async function launchApp(
  userData = tempDir('profile')
): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, STUDIO_USER_DATA: userData } })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  return { app, window }
}

/** Makes the next native save dialog return `path` without showing UI. */
export async function stubSaveDialog(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog
  }, path)
}

/** Opens a file the same way "Open with" does (main → renderer event). */
export async function openViaMain(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, filePath) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('app:open-path', { path: filePath })
  }, path)
}

/** Solid-color RGB PNG encoded by hand (no image libraries needed). */
export function makePng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // truecolor RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => rgb).flat())])
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** PNG width/height from the IHDR chunk. */
export function pngSize(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

/** Minimal valid multi-page PDF (Helvetica text, so pdf.js must load its standard font data). */
export function makePdf(pages: string[]): Buffer {
  const objects: string[] = []
  const add = (body: string) => objects.push(body) // object number = index + 1
  const pageCount = pages.length
  const firstPage = 4
  add('<< /Type /Catalog /Pages 2 0 R >>')
  add(
    `<< /Type /Pages /Count ${pageCount} /Kids [${pages.map((_, i) => `${firstPage + i * 2} 0 R`).join(' ')}] >>`
  )
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  pages.forEach((text, i) => {
    const content = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${firstPage + i * 2 + 1} 0 R >>`
    )
    add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
  })

  let out = '%PDF-1.7\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out))
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = Buffer.byteLength(out)
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

/**
 * Quits without the unsaved-changes prompt (a native modal would block the run forever).
 * Workspaces stay behind in the throwaway profile, which is fine for tests.
 */
export async function closeApp(app: ElectronApplication): Promise<void> {
  const exited = new Promise((resolve) => app.process().once('exit', resolve))
  await app
    .evaluate(({ app: electronApp }) => setTimeout(() => electronApp.exit(0), 0))
    .catch(() => undefined)
  await exited
}
