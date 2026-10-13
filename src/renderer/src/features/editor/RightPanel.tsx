import { useState } from 'react'
import { InspectorPanel } from '../inspector/InspectorPanel'
import { LayersPanel } from '../layers/LayersPanel'
import { PagesPanel } from '../pages/PagesPanel'
import { AiPanel } from '../ai/AiPanel'
import { useGenerate } from '../ai/generate'
import { useDocumentStore } from '../document/store'
import styles from './Editor.module.css'

type Tab = 'pages' | 'layers' | 'inspector' | 'ai'

export function RightPanel() {
  const pageCount = useDocumentStore((s) => s.doc?.pages.length ?? 0)
  const docId = useDocumentStore((s) => s.docId)
  const generationCount = useDocumentStore((s) => s.doc?.generations?.length ?? 0)
  // A document with several pages starts on its page list, so every page is in view.
  const [tab, setTab] = useState<Tab>(() => (pageCount > 1 ? 'pages' : 'inspector'))
  const [openedDoc, setOpenedDoc] = useState(docId)
  if (docId !== openedDoc) {
    setOpenedDoc(docId)
    setTab(pageCount > 1 ? 'pages' : 'inspector')
  }
  // New results open the AI tab so they are seen.
  const latest = useGenerate((s) => s.latest)
  const [shownLatest, setShownLatest] = useState(latest)
  if (latest !== shownLatest) {
    setShownLatest(latest)
    if (latest) setTab('ai')
  }
  const tabs: { id: Tab; label: string }[] = [
    { id: 'inspector', label: 'Inspector' },
    { id: 'layers', label: 'Layers' },
    ...(pageCount > 1 ? [{ id: 'pages' as const, label: `Pages (${pageCount})` }] : []),
    { id: 'ai', label: generationCount ? `AI (${generationCount})` : 'AI' }
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
        {active === 'ai' && <AiPanel />}
      </div>
    </aside>
  )
}
