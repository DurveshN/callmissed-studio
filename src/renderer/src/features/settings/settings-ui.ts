import { create } from 'zustand'

/** Whether the Settings dialog is open (opened from the start screen and the editor top bar). */
export const useSettingsUi = create<{ open: boolean; setOpen(open: boolean): void }>()((set) => ({
  open: false,
  setOpen: (open) => set({ open })
}))
