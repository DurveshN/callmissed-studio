import { Eye, EyeOff, Image as ImageIcon, Lock, Shapes, Trash2, Type, Unlock } from 'lucide-react'
import { useState } from 'react'
import type { Layer } from '@shared/document/model'
import { deleteLayers, moveLayer, updateLayer } from '../document/layer-ops'
import { selectActivePage, useDocumentStore } from '../document/store'
import ui from '../../ui/ui.module.css'
import styles from './LayersPanel.module.css'

const ICONS = { text: Type, image: ImageIcon, shape: Shapes } as const

function LayerRow({ layer, index, selected }: { layer: Layer; index: number; selected: boolean }) {
  const [renaming, setRenaming] = useState(false)
  const [dropTarget, setDropTarget] = useState(false)
  const select = useDocumentStore((s) => s.select)
  const selection = useDocumentStore((s) => s.selection)
  const Icon = ICONS[layer.type]

  return (
    <li
      className={styles.row}
      data-selected={selected}
      data-drop={dropTarget}
      data-testid="layer-row"
      draggable={!renaming}
      onDragStart={(e) => e.dataTransfer.setData('text/x-layer-id', layer.id)}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('text/x-layer-id')) return
        e.preventDefault()
        setDropTarget(true)
      }}
      onDragLeave={() => setDropTarget(false)}
      onDrop={(e) => {
        setDropTarget(false)
        const id = e.dataTransfer.getData('text/x-layer-id')
        if (id && id !== layer.id) moveLayer(id, index)
      }}
      onClick={(e) => {
        if (e.shiftKey || e.ctrlKey) {
          select(
            selection.includes(layer.id) ? selection.filter((s) => s !== layer.id) : [...selection, layer.id]
          )
        } else select([layer.id])
      }}
    >
      <Icon size={14} className={styles.typeIcon} />
      {renaming ? (
        <input
          className={ui.input}
          defaultValue={layer.name}
          autoFocus
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => {
            setRenaming(false)
            const name = e.target.value.trim()
            if (name && name !== layer.name) updateLayer(layer.id, { name }, 'Rename layer')
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') setRenaming(false)
          }}
        />
      ) : (
        <span className={styles.name} data-hidden={!layer.visible} onDoubleClick={() => setRenaming(true)}>
          {layer.type === 'text' && layer.name === 'Text' ? layer.text.split('\n')[0] || 'Text' : layer.name}
        </span>
      )}
      <span className={styles.actions}>
        <button
          className={ui.iconButton}
          aria-label={layer.locked ? 'Unlock' : 'Lock'}
          title={layer.locked ? 'Unlock' : 'Lock'}
          data-active={layer.locked}
          onClick={(e) => {
            e.stopPropagation()
            updateLayer(layer.id, { locked: !layer.locked }, layer.locked ? 'Unlock layer' : 'Lock layer')
          }}
        >
          {layer.locked ? <Lock size={14} /> : <Unlock size={14} />}
        </button>
        <button
          className={ui.iconButton}
          aria-label={layer.visible ? 'Hide' : 'Show'}
          title={layer.visible ? 'Hide' : 'Show'}
          onClick={(e) => {
            e.stopPropagation()
            updateLayer(layer.id, { visible: !layer.visible }, layer.visible ? 'Hide layer' : 'Show layer')
          }}
        >
          {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
        <button
          className={ui.iconButton}
          aria-label="Delete layer"
          title="Delete layer"
          onClick={(e) => {
            e.stopPropagation()
            deleteLayers([layer.id])
          }}
        >
          <Trash2 size={14} />
        </button>
      </span>
    </li>
  )
}

export function LayersPanel() {
  const page = useDocumentStore(selectActivePage)
  const selection = useDocumentStore((s) => s.selection)
  if (!page) return null
  const layers = page.layers.map((layer, index) => ({ layer, index })).reverse()

  return (
    <div className={styles.panel}>
      {layers.length === 0 && (
        <p className={styles.empty}>No layers yet. Add text, shapes or images from the toolbar.</p>
      )}
      <ul className={styles.list}>
        {layers.map(({ layer, index }) => (
          <LayerRow key={layer.id} layer={layer} index={index} selected={selection.includes(layer.id)} />
        ))}
        <li className={styles.row} data-background>
          <ImageIcon size={14} className={styles.typeIcon} />
          <span className={styles.name}>Background</span>
          <Lock size={14} className={styles.typeIcon} />
        </li>
      </ul>
    </div>
  )
}
