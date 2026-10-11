import { z } from 'zod'

export const Settings = z.object({
  /** 'auto' uses the GPU (DirectML) when it works and falls back to CPU; 'off' always uses CPU. */
  gpu: z.enum(['auto', 'off']),
  /** The user finished or skipped the first-run "Set up AI features" screen. */
  modelSetupDone: z.boolean(),
  /**
   * Model files ("pack/file") that failed while running on this device's GPU; they run on CPU from then
   * on. Cleared when GPU acceleration is turned back on (e.g. after a driver update).
   */
  gpuIncompatible: z.array(z.string().max(200)).max(64)
})
export type Settings = z.infer<typeof Settings>

export const DEFAULT_SETTINGS: Settings = { gpu: 'auto', modelSetupDone: false, gpuIncompatible: [] }

export const SettingsPatch = Settings.partial()
export type SettingsPatch = z.infer<typeof SettingsPatch>
