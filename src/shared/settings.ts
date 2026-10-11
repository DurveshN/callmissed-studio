import { z } from 'zod'

export const Settings = z.object({
  /** 'auto' uses the GPU (DirectML) when it works and falls back to CPU; 'off' always uses CPU. */
  gpu: z.enum(['auto', 'off']),
  /** The user finished or skipped the first-run "Set up AI features" screen. */
  modelSetupDone: z.boolean()
})
export type Settings = z.infer<typeof Settings>

export const DEFAULT_SETTINGS: Settings = { gpu: 'auto', modelSetupDone: false }

export const SettingsPatch = Settings.partial()
export type SettingsPatch = z.infer<typeof SettingsPatch>
