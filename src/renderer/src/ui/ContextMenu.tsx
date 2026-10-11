import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useContextMenuStore } from './context-menu'
import styles from './ContextMenu.module.css'

const MARGIN = 8

/** Floating menu opened by openContextMenu(); closes on outside click, Escape, scroll, resize or blur. */
export function ContextMenu() {
  const menu = useContextMenuStore((s) => s.menu)
  const close = useContextMenuStore((s) => s.close)
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    const el = ref.current
    if (!menu || !el) return
    const { width, height } = el.getBoundingClientRect()
    setPosition({
      left: Math.min(menu.x, window.innerWidth - width - MARGIN),
      top: Math.min(menu.y, window.innerHeight - height - MARGIN)
    })
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const onPointer = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        close()
      }
    }
    window.addEventListener('mousedown', onPointer, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('wheel', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    return () => {
      window.removeEventListener('mousedown', onPointer, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('wheel', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
    }
  }, [menu, close])

  if (!menu) return null
  return (
    <div
      ref={ref}
      className={styles.menu}
      role="menu"
      style={position}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
        e.preventDefault()
        const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const next = (at + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
        buttons[next]?.focus()
      }}
    >
      {menu.items.map((item, i) =>
        item === 'separator' ? (
          <div key={i} className={styles.separator} role="separator" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={styles.item}
            data-danger={item.danger}
            disabled={item.disabled}
            onClick={() => {
              close()
              item.onSelect()
            }}
          >
            <span className={styles.icon}>{item.icon}</span>
            <span className={styles.label}>{item.label}</span>
            {item.shortcut && <span className={styles.shortcut}>{item.shortcut}</span>}
          </button>
        )
      )}
    </div>
  )
}
