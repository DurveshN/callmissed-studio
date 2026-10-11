import { randomUUID } from 'node:crypto'
import { open, rename, rm } from 'node:fs/promises'

/** Writes via a temp file + fsync + rename so a crash never leaves a half-written file. */
export async function writeFileAtomic(path: string, data: Uint8Array | string): Promise<void> {
  const tmp = `${path}.${randomUUID()}.tmp`
  const handle = await open(tmp, 'w')
  try {
    await handle.writeFile(data)
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(tmp, path)
  } catch (error) {
    await rm(tmp, { force: true })
    throw error
  }
}
