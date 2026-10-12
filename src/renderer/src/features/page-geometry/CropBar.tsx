import { Crop } from 'lucide-react'
import ui from '../../ui/ui.module.css'
import { FloatingBar } from '../../ui/FloatingBar'
import { useToolStore } from '../tools/tool-store'
import { applyCrop, cancelCrop, useCropStore } from './crop'

/** Apply / Cancel while the Crop tool is active. */
export function CropBar() {
  const tool = useToolStore((s) => s.tool)
  const target = useCropStore((s) => s.target)
  if (tool !== 'crop' || !target) return null
  return (
    <FloatingBar
      testId="crop-bar"
      status="ready"
      text={`Drag the box or its handles to crop the ${target.kind === 'page' ? 'page' : 'image'}`}
      icon={<Crop size={16} />}
      onClose={cancelCrop}
      closeLabel="Cancel crop"
    >
      <button className={ui.primaryButton} onClick={() => void applyCrop()}>
        Apply
      </button>
    </FloatingBar>
  )
}
