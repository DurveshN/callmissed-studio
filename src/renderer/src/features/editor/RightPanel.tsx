import { useState } from 'react'
import { InspectorPanel } from '../inspector/InspectorPanel'
import { LayersPanel } from '../layers/LayersPanel'
import { PagesPanel } from '../pages/PagesPanel'
import { useDocumentStore } from '../document/store'
import styles from './Editor.module.css'

type Tab = 'pages' | 'layers' | 'inspector'

export function RightPanel() {
  const pageCount = useDocumentStore((s) => s.doc?.pages.length ?? 0)
  const docId = useDocumentStore((s) => s.docId)
  // A document with several pages starts on its page list, so every page is in view.
  const [tab, setTab] = useState<Tab>(() => (pageCount > 1 ? 'pages' : 'inspector'))
  const [openedDoc, setOpenedDoc] = useState(docId)
  if (docId !== openedDoc) {
    setOpenedDoc(docId)
    setTab(pageCount > 1 ? 'pages' : 'inspector')
  }
  const tabs: { id: Tab; label: string }[] = [
    { id: 'inspector', label: 'Inspector' },
    { id: 'layers', label: 'Layers' },
    ...(pageCount > 1 ? [{ id: 'pages' as const, label: `Pages (${pageCount})` }] : [])
  ]
  const active = tabs.some((t) => t.id === tab) ? tab : 'inspector'

  return (
    <aside className={styles.rightPanel}>
      <div className={styles.tabs} role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={active === t.id}
            className={styles.tab}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className={styles.tabBody} role="tabpanel">
        {active === 'inspector' && <InspectorPanel />}
        {active === 'layers' && <LayersPanel />}
        {active === 'pages' && <PagesPanel />}
      </div>
    </aside>
  )
}
