import { readFile, rm } from 'node:fs/promises'
import { StudioError } from '@shared/ipc/result'
import { writeFileAtomic } from './fs-utils'

/** The part of Electron's safeStorage used here (injectable for tests). */
export interface Cipher {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

/** CallMissed keys look like cm_ followed by URL-safe characters. */
const KEY_PATTERN = /^cm_[A-Za-z0-9_-]{8,256}$/

/**
 * The CallMissed API key, encrypted with the OS (Windows DPAPI via safeStorage) in one file. It never
 * leaves the main process; the UI only sees whether a key is set and its last characters.
 */
export class SecretStore {
  constructor(
    private readonly file: string,
    private readonly cipher: Cipher
  ) {}

  get available(): boolean {
    return this.cipher.isEncryptionAvailable()
  }

  async getKey(): Promise<string | null> {
    try {
      return this.cipher.decryptString(await readFile(this.file))
    } catch {
      return null // missing, or unreadable (e.g. copied from another Windows account)
    }
  }

  async setKey(key: string): Promise<void> {
    const trimmed = key.trim()
    if (!KEY_PATTERN.test(trimmed)) {
      throw new StudioError(
        'INVALID_INPUT',
        'That does not look like a CallMissed API key (it starts with cm_).'
      )
    }
    if (!this.available) {
      throw new StudioError(
        'INVALID_INPUT',
        'Secure storage is not available on this PC, so the key cannot be saved safely.'
      )
    }
    await writeFileAtomic(this.file, this.cipher.encryptString(trimmed))
  }

  async removeKey(): Promise<void> {
    await rm(this.file, { force: true })
  }

  /** "cm_…abcd" for display, or null when no key is set. */
  async hint(): Promise<string | null> {
    const key = await this.getKey()
    return key ? `cm_…${key.slice(-4)}` : null
  }
}
