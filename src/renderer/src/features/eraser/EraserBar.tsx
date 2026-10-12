import { Eraser } from 'lucide-react'
import ui from '../../ui/ui.module.css'
import { FloatingBar, floatingBarStyles as styles } from '../../ui/FloatingBar'
import { useToolStore } from '../tools/tool-store'
import { BRUSH_SIZES, useEraserStore } from './eraser'

/** Brush size and fill quality while the Eraser tool is active. */
export function EraserBar() {
  const tool = useToolStore((s) => s.tool)
  const { size, quality, status, progress } = useEraserStore()
  if (tool !== 'erase') return null
  const busy = status === 'working'
  return (
    <FloatingBar
      testId="eraser-bar"
      status={status}
      text={busy ? 'Erasing…' : 'Paint over what to remove'}
      icon={<Eraser size={16} />}
      busy={busy}
      progress={progress}
      onClose={() => useToolStore.getState().setTool('select')}
      closeLabel="Close Eraser"
    >
      <span className={styles.divider} />
      <label className={styles.label} htmlFor="brush-size">
        Size
      </label>
      <input
        id="brush-size"
        className={styles.range}
        type="range"
        min={BRUSH_SIZES.min}
        max={BRUSH_SIZES.max}
        value={size}
        onChange={(e) => useEraserStore.setState({ size: Number(e.target.value) })}
      />
      <span className={styles.divider} />
      {(['auto', 'fast'] as const).map((q) => (
        <button
          key={q}
          className={`${ui.button} ${styles.segment}`}
          aria-pressed={quality === q}
          title={
            q === 'auto'
              ? 'Best result (uses the High-quality eraser when installed)'
              : 'Instant fill, best on plain backgrounds'
          }
          onClick={() => useEraserStore.setState({ quality: q })}
        >
          {q === 'auto' ? 'Best' : 'Fast'}
        </button>
      ))}
    </FloatingBar>
  )
}
