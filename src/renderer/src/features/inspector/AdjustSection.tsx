import type { Adjustments } from '@shared/document/model'
import { NEUTRAL, isNeutral } from '../adjust/adjust'
import { setAdjustments } from '../adjust/adjust-ops'
import type { RasterTarget } from '../raster/raster-target'
import ui from '../../ui/ui.module.css'
import styles from './InspectorPanel.module.css'

const CONTROLS = [
  ['brightness', 'Brightness'],
  ['contrast', 'Contrast'],
  ['saturation', 'Saturation']
] as const

/** Brightness / contrast / saturation of an image layer or of the page picture. */
export function AdjustSection({
  target,
  adjustments
}: {
  target: RasterTarget
  adjustments: Adjustments | undefined
}) {
  const current = adjustments ?? NEUTRAL
  const id = target.kind === 'page' ? target.pageId : target.layerId
  return (
    <section className={styles.section} data-testid="adjust-section">
      <h3 className={styles.heading}>Adjust</h3>
      {CONTROLS.map(([key, label]) => (
        <label key={key} className={styles.slider}>
          <span>{label}</span>
          <input
            type="range"
            min={-100}
            max={100}
            value={Math.round(current[key] * 100)}
            aria-label={label}
            onChange={(e) =>
              setAdjustments(
                target,
                { ...current, [key]: Number(e.target.value) / 100 },
                `adjust:${key}:${id}`
              )
            }
          />
          <output>{Math.round(current[key] * 100)}</output>
        </label>
      ))}
      <div className={styles.row}>
        <button
          className={ui.button}
          disabled={isNeutral(adjustments)}
          onClick={() => setAdjustments(target, NEUTRAL)}
        >
          Reset
        </button>
      </div>
    </section>
  )
}
