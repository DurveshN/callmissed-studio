import {
  Circle,
  Download,
  FolderOpen,
  Hand,
  ImagePlus,
  Maximize,
  Minus,
  MousePointer2,
  Plus,
  Redo2,
  Save,
  Slash,
  Square,
  Type,
  Settings,
  Undo2,
  X
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { commands } from '../commands/commands'
import { selectIsDirty, useDocumentStore } from '../document/store'
import { useToolStore, type Tool } from '../tools/tool-store'
import { useViewportStore } from '../canvas/viewport-store'
import { useSettingsUi } from '../settings/settings-ui'
import ui from '../../ui/ui.module.css'
import styles from './Editor.module.css'

const TOOLS: { tool: Tool; label: string; key: string; icon: ReactNode }[] = [
  { tool: 'select', label: 'Select', key: 'V', icon: <MousePointer2 size={18} /> },
  { tool: 'hand', label: 'Hand', key: 'H', icon: <Hand size={18} /> },
  { tool: 'text', label: 'Text', key: 'T', icon: <Type size={18} /> },
  { tool: 'rect', label: 'Rectangle', key: 'R', icon: <Square size={18} /> },
  { tool: 'ellipse', label: 'Ellipse', key: 'E', icon: <Circle size={18} /> },
  { tool: 'line', label: 'Line', key: 'L', icon: <Slash size={18} /> }
]

function IconButton(props: {
  label: string
  onClick(): void
  children: ReactNode
  pressed?: boolean
  disabled?: boolean
}) {
  return (
    <button
      className={ui.iconButton}
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.pressed}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

export function TopBar({ onExport }: { onExport(): void }) {
  const { name, dirty, canUndo, canRedo, undoLabel, redoLabel } = useDocumentStore(
    useShallow((s) => ({
      name: s.doc?.name ?? '',
      dirty: selectIsDirty(s),
      canUndo: s.undoStack.length > 0,
      canRedo: s.redoStack.length > 0,
      undoLabel: s.undoStack.at(-1)?.label,
      redoLabel: s.redoStack.at(-1)?.label
    }))
  )
  const tool = useToolStore((s) => s.tool)
  const setTool = useToolStore((s) => s.setTool)
  const zoom = useViewportStore((s) => s.scale)

  return (
    <header className={styles.topBar}>
      <div className={styles.group}>
        <div className={styles.brandMark} aria-hidden />
        <IconButton label="Open… (Ctrl+O)" onClick={() => void commands.openDialog()}>
          <FolderOpen size={18} />
        </IconButton>
        <IconButton label="Save (Ctrl+S)" onClick={() => void commands.save()}>
          <Save size={18} />
        </IconButton>
        <IconButton label="Export (Ctrl+E)" onClick={onExport}>
          <Download size={18} />
        </IconButton>
        <span className={styles.docName} title={name} data-testid="doc-name">
          {name}
          {dirty && <span className={styles.dirtyDot} aria-label="Unsaved changes" />}
        </span>
      </div>

      <div className={styles.group} role="toolbar" aria-label="Tools">
        {TOOLS.map((t) => (
          <IconButton
            key={t.tool}
            label={`${t.label} (${t.key})`}
            pressed={tool === t.tool}
            onClick={() => setTool(t.tool)}
          >
            {t.icon}
          </IconButton>
        ))}
        <span className={styles.divider} />
        <IconButton label="Insert image (I)" onClick={() => void commands.insertImage()}>
          <ImagePlus size={18} />
        </IconButton>
      </div>

      <div className={styles.group}>
        <IconButton label={`Undo ${undoLabel ?? ''} (Ctrl+Z)`} disabled={!canUndo} onClick={commands.undo}>
          <Undo2 size={18} />
        </IconButton>
        <IconButton label={`Redo ${redoLabel ?? ''} (Ctrl+Y)`} disabled={!canRedo} onClick={commands.redo}>
          <Redo2 size={18} />
        </IconButton>
        <span className={styles.divider} />
        <IconButton label="Zoom out (Ctrl+-)" onClick={commands.zoomOut}>
          <Minus size={16} />
        </IconButton>
        <button className={styles.zoomValue} title="Actual size (Ctrl+1)" onClick={commands.actualSize}>
          {Math.round(zoom * 100)}%
        </button>
        <IconButton label="Zoom in (Ctrl+=)" onClick={commands.zoomIn}>
          <Plus size={16} />
        </IconButton>
        <IconButton label="Fit to screen (Ctrl+0)" onClick={commands.fit}>
          <Maximize size={16} />
        </IconButton>
        <span className={styles.divider} />
        <IconButton label="Settings" onClick={() => useSettingsUi.getState().setOpen(true)}>
          <Settings size={18} />
        </IconButton>
        <IconButton label="Close document" onClick={() => void commands.close()}>
          <X size={18} />
        </IconButton>
      </div>
    </header>
  )
}
