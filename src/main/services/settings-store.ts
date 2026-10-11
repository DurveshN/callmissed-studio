import { readFile } from 'node:fs/promises'
import { DEFAULT_SETTINGS, Settings, type SettingsPatch } from '@shared/settings'
import { writeFileAtomic } from './fs-utils'

/** settings.json in userData; missing fields take defaults and an invalid file resets to defaults. */
export class SettingsStore {
  private current: Settings = DEFAULT_SETTINGS
  private readonly listeners = new Set<(settings: Settings) => void>()

  constructor(private readonly file: string) {}

  async load(): Promise<Settings> {
    try {
      const raw: unknown = JSON.parse(await readFile(this.file, 'utf8'))
      this.current = Settings.parse({ ...DEFAULT_SETTINGS, ...Settings.partial().catch({}).parse(raw) })
    } catch {
      this.current = DEFAULT_SETTINGS
    }
    return this.current
  }

  get(): Settings {
    return this.current
  }

  async update(patch: SettingsPatch): Promise<Settings> {
    this.current = Settings.parse({ ...this.current, ...patch })
    await writeFileAtomic(this.file, JSON.stringify(this.current, null, 2))
    for (const listener of this.listeners) listener(this.current)
    return this.current
  }

  onChange(listener: (settings: Settings) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
