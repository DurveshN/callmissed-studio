import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useDocumentStore } from '../document/store'
import ui from '../../ui/ui.module.css'
import { stepPage } from './page-ops'
import styles from './PageNavigator.module.css'

/** "‹ Page 2 of 6 ›" at the bottom of the canvas for documents with several pages. */
export function PageNavigator() {
  const count = useDocumentStore((s) => s.doc?.pages.length ?? 0)
  const index = useDocumentStore((s) => s.doc?.pages.findIndex((p) => p.id === s.activePageId) ?? -1)
  if (count < 2) return null
  const current = Math.max(0, index)
  return (
    <nav className={styles.nav} aria-label="Pages" data-testid="page-navigator">
      <button
        className={ui.iconButton}
        aria-label="Previous page (Page Up)"
        title="Previous page (Page Up)"
        disabled={current === 0}
        onClick={() => stepPage(-1)}
      >
        <ChevronLeft size={16} />
      </button>
      <span className={styles.label}>
        Page {current + 1} of {count}
      </span>
      <button
        className={ui.iconButton}
        aria-label="Next page (Page Down)"
        title="Next page (Page Down)"
        disabled={current === count - 1}
        onClick={() => stepPage(1)}
      >
        <ChevronRight size={16} />
      </button>
    </nav>
  )
}
