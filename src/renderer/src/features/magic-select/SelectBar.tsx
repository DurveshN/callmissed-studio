import { Copy, Scissors, Trash2, WandSparkles } from 'lucide-react'
import ui from '../../ui/ui.module.css'
import { FloatingBar } from '../../ui/FloatingBar'
import { useToolStore } from '../tools/tool-store'
import { applySelection, clearSelection } from './magic-select'
import { useSelectStore } from './select-store'

/** Hint, progress and object actions while the Magic Select tool is active. */
export function SelectBar() {
  const tool = useToolStore((s) => s.tool)
  const { status, mask, message, progress } = useSelectStore()
  if (tool !== 'magic') return null
  const busy = status === 'preparing' || status === 'selecting' || status === 'applying'
  const text =
    message ??
    (status === 'applying'
      ? 'Applying…'
      : status === 'selecting'
        ? 'Selecting…'
        : mask
          ? 'Shift+click to add, Alt+click to remove parts'
          : 'Click an object, or drag a box around it')

  return (
    <FloatingBar
      testId="select-bar"
      status={status}
      text={text}
      icon={<WandSparkles size={16} />}
      busy={busy}
      progress={progress}
      onClose={() => (mask ? clearSelection() : useToolStore.getState().setTool('select'))}
      closeLabel={mask ? 'Clear selection' : 'Close Magic Select'}
    >
      {mask && status === 'ready' && (
        <>
          <button className={ui.button} onClick={() => applySelection('cut')}>
            <Scissors size={14} /> Cut to layer
          </button>
          <button className={ui.button} onClick={() => applySelection('copy')}>
            <Copy size={14} /> Copy to layer
          </button>
          <button className={ui.primaryButton} onClick={() => applySelection('delete')}>
            <Trash2 size={14} /> Remove
          </button>
        </>
      )}
    </FloatingBar>
  )
}
