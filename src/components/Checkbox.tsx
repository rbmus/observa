import { Icon } from './icons'

interface Props {
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
  label?: string
}

export default function Checkbox({ checked, onChange, disabled, label }: Props) {
  return (
    <label className={`checkbox ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={e => onChange(e.target.checked)}
      />
      <span className="checkbox-box">
        <Icon name="check" size={12} />
      </span>
      {label && <span className="checkbox-label">{label}</span>}
    </label>
  )
}
