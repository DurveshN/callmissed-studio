import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { TextLayer } from '@shared/document/model'
import { deleteLayers, updateLayer } from '../document/layer-ops'
import { useToolStore } from '../tools/tool-store'
import { useViewportStore } from './viewport-store'
import styles from './CanvasView.module.css'

interface Props {
  layer: TextLayer
}

/** In-place text editing: a textarea laid exactly over the Konva text node. */
export function TextEditor({ layer }: Props) {
  const { scale, x, y } = useViewportStore()
  const [value, setValue] = useState(layer.text)
  const ref = useRef<HTMLTextAreaElement>(null)
  const done = useRef(false)

  useEffect(() => {
    // Focus after the current pointer event finishes so its default action can't steal focus back.
    const frame = requestAnimationFrame(() => {
      ref.current?.focus()
      ref.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }, [value, scale])

  const finish = (commit: boolean) => {
    if (done.current) return
    done.current = true
    useToolStore.getState().editText(null)
    if (!commit) return
    if (value.trim() === '') deleteLayers([layer.id])
    else if (value !== layer.text) updateLayer(layer.id, { text: value }, 'Edit text')
  }

  return (
    <textarea
      ref={ref}
      className={styles.textEditor}
      value={value}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault()
          finish(true)
        }
      }}
      style={{
        left: x + layer.x * scale,
        top: y + layer.y * scale,
        width: layer.width * scale,
        transform: `rotate(${layer.rotation}deg)`,
        fontFamily: layer.fontFamily,
        fontSize: layer.fontSize * scale,
        fontWeight: layer.fontWeight,
        fontStyle: layer.italic ? 'italic' : 'normal',
        lineHeight: layer.lineHeight,
        color: layer.color,
        textAlign: layer.align
      }}
    />
  )
}
