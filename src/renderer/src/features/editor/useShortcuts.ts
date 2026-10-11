import { useEffect } from 'react'
import { commands } from '../commands/commands'
import { deleteLayers, duplicateLayers, nudgeLayers, shiftLayers } from '../document/layer-ops'
import { selectActivePage, useDocumentStore } from '../document/store'
import { cancelDetect, detectText } from '../text-detect/detect'
import { useDetectStore } from '../text-detect/detect-store'
import { TOOL_SHORTCUTS, useToolStore } from '../tools/tool-store'

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement && (target.isContentEditable || !!target.closest('input, textarea, select'))
  )
}

/** File commands that must work even while a field has focus. */
const GLOBAL_KEYS = new Set(['s', 'o', 'e'])

/** Editor keyboard shortcuts (only file commands while typing in a field). */
export function useShortcuts(onExport: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if (isTyping(e.target) || useToolStore.getState().editingTextId) {
        if (!mod || !GLOBAL_KEYS.has(key)) return
        // Blurring commits the pending field value before the command reads the document.
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      }
      const { selection, select } = useDocumentStore.getState()

      const run = (fn: () => unknown) => {
        e.preventDefault()
        fn()
      }

      if (mod) {
        if (key === 'z' && e.shiftKey) return run(commands.redo)
        if (key === 'z') return run(commands.undo)
        if (key === 'y') return run(commands.redo)
        if (key === 's') return run(() => void commands.save(e.shiftKey))
        if (key === 'o') return run(() => void commands.openDialog())
        if (key === 'e') return run(onExport)
        if (key === 'd') return run(() => duplicateLayers(selection))
        if (key === 'a') {
          return run(() => {
            const page = selectActivePage(useDocumentStore.getState())
            select(page?.layers.filter((l) => l.visible && !l.locked).map((l) => l.id) ?? [])
          })
        }
        if (key === '0') return run(commands.fit)
        if (key === '1') return run(commands.actualSize)
        if (key === '=' || key === '+') return run(commands.zoomIn)
        if (key === '-') return run(commands.zoomOut)
        if (key === ']') return run(() => shiftLayers(selection, e.shiftKey ? Infinity : 1))
        if (key === '[') return run(() => shiftLayers(selection, e.shiftKey ? -Infinity : -1))
        return
      }

      if (key === 'delete' || key === 'backspace') return run(() => deleteLayers(selection))
      if (key === 'escape') {
        return run(() => (useDetectStore.getState().status !== 'idle' ? cancelDetect() : select([])))
      }
      if (key === 'd') return run(() => void detectText())
      if (key === 'i') return run(() => void commands.insertImage())
      const step = e.shiftKey ? 10 : 1
      if (key === 'arrowleft') return run(() => nudgeLayers(selection, -step, 0))
      if (key === 'arrowright') return run(() => nudgeLayers(selection, step, 0))
      if (key === 'arrowup') return run(() => nudgeLayers(selection, 0, -step))
      if (key === 'arrowdown') return run(() => nudgeLayers(selection, 0, step))
      const tool = TOOL_SHORTCUTS[key]
      if (tool && !e.altKey) return run(() => useToolStore.getState().setTool(tool))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onExport])
}
