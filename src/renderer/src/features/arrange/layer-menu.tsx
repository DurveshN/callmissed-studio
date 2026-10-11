import { Copy, Eye, EyeOff, Lock, Trash2, Unlock } from 'lucide-react'
import { openContextMenu, type MenuItem } from '../../ui/context-menu'
import { deleteLayers, duplicateLayers, updateLayers } from '../document/layer-ops'
import { selectActivePage, useDocumentStore } from '../document/store'
import { ARRANGE_ACTIONS, arrange, canArrange } from './arrange'
import { ArrangeIcon } from './ArrangeIcon'

/** Selects `layerId` (unless already part of the selection) and opens the layer context menu there. */
export function openLayerMenu(x: number, y: number, layerId: string): void {
  const state = useDocumentStore.getState()
  const ids = state.selection.includes(layerId) ? state.selection : [layerId]
  if (ids !== state.selection) state.select(ids)
  const layers = selectActivePage(state)?.layers ?? []
  const selected = layers.filter((l) => ids.includes(l.id))
  const allLocked = selected.every((l) => l.locked)
  const allHidden = selected.every((l) => !l.visible)

  const items: MenuItem[] = [
    ...ARRANGE_ACTIONS.map(({ action, label, shortcut }) => ({
      label,
      shortcut,
      icon: <ArrangeIcon action={action} />,
      disabled: !canArrange(layers, ids, action),
      onSelect: () => arrange(ids, action)
    })),
    'separator',
    {
      label: 'Duplicate',
      shortcut: 'Ctrl+D',
      icon: <Copy size={16} />,
      onSelect: () => duplicateLayers(ids)
    },
    {
      label: allLocked ? 'Unlock' : 'Lock',
      icon: allLocked ? <Unlock size={16} /> : <Lock size={16} />,
      onSelect: () =>
        updateLayers(
          ids.map((id) => [id, { locked: !allLocked }]),
          allLocked ? 'Unlock' : 'Lock'
        )
    },
    {
      label: allHidden ? 'Show' : 'Hide',
      icon: allHidden ? <Eye size={16} /> : <EyeOff size={16} />,
      onSelect: () =>
        updateLayers(
          ids.map((id) => [id, { visible: allHidden }]),
          allHidden ? 'Show' : 'Hide'
        )
    },
    'separator',
    {
      label: 'Delete',
      shortcut: 'Del',
      icon: <Trash2 size={16} />,
      danger: true,
      onSelect: () => deleteLayers(ids)
    }
  ]
  openContextMenu(x, y, items)
}
