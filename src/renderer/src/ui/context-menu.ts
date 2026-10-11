import type { ReactNode } from 'react'
import { create } from 'zustand'

export type MenuItem =
  | {
      label: string
      onSelect(): void
      icon?: ReactNode
      shortcut?: string
      disabled?: boolean
      danger?: boolean
    }
  | 'separator'

interface ContextMenuState {
  menu: { x: number; y: number; items: MenuItem[] } | null
  open(x: number, y: number, items: MenuItem[]): void
  close(): void
}

export const useContextMenuStore = create<ContextMenuState>()((set) => ({
  menu: null,
  open: (x, y, items) => set({ menu: { x, y, items } }),
  close: () => set({ menu: null })
}))

export const openContextMenu = (x: number, y: number, items: MenuItem[]) =>
  useContextMenuStore.getState().open(x, y, items)
