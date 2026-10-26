import { ALL_FONTS, fontByFamily } from './catalog'
import ui from '../../ui/ui.module.css'

/** Font family picker: the included fonts, then Windows fonts (each shown in its own face). */
export function FontSelect({
  value,
  onChange,
  className = ui.select
}: {
  value: string
  onChange(family: string): void
  className?: string
}) {
  return (
    <select className={className} aria-label="Font" value={value} onChange={(e) => onChange(e.target.value)}>
      {!fontByFamily(value) && <option value={value}>{value}</option>}
      <optgroup label="Included fonts">
        {ALL_FONTS.filter((f) => f.source === 'bundled').map((f) => (
          <option key={f.family} value={f.family} style={{ fontFamily: f.family }}>
            {f.family}
          </option>
        ))}
      </optgroup>
      <optgroup label="Windows fonts">
        {ALL_FONTS.filter((f) => f.source === 'system').map((f) => (
          <option key={f.family} value={f.family} style={{ fontFamily: f.family }}>
            {f.family}
          </option>
        ))}
      </optgroup>
    </select>
  )
}
