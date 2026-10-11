import { create } from 'zustand'

export type Tool = 'select' | 'hand' | 'text' | 'rect' | 'ellipse' | 'line'

interface ToolState {
  tool: Tool
  /** Layer whose text is being edited in place, if any. */
  editingTextId: string | null
  setTool(tool: Tool): void
  editText(layerId: string | null): void
}

export const useToolStore = create<ToolState>()((set) => ({
  tool: 'select',
  editingTextId: null,
  setTool: (tool) => set({ tool, editingTextId: null }),
  editText: (layerId) => set({ editingTextId: layerId })
}))

export const TOOL_SHORTCUTS: Record<string, Tool> = {
  v: 'select',
  h: 'hand',
  t: 'text',
  r: 'rect',
  e: 'ellipse',
  l: 'line'
}
