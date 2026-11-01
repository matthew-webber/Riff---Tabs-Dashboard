import { useMemo, useState } from 'react'
import type { TuningPreset } from '@/lib/api'
import { cn, fold } from '@/lib/utils'
import { SuggestionList, type Suggestion } from './Suggestions'
import { inputClass } from './ui/input'

interface Props {
  value: string
  onChange: (v: string) => void
  /** Called when the user settles on a value (pick, Enter, blur). */
  onCommit?: (v: string) => void
  presets: TuningPreset[]
  inUse: string[]
  placeholder?: string
  className?: string
  id?: string
}

const squash = (s: string) => fold(s).replace(/[\s,\-/|]+/g, '')

export function TuningInput({ value, onChange, onCommit, presets, inUse, placeholder = 'Standard, Drop D, DADGBE…', className, id }: Props) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)

  const items = useMemo<Suggestion[]>(() => {
    const all: Suggestion[] = [
      ...presets.map((p) => ({ value: p.name, label: p.name, detail: p.notes, group: p.common ? 'common' : 'more' })),
      ...inUse.filter((t) => !presets.some((p) => p.name === t)).map((t) => ({ value: t, label: t, detail: 'custom', group: 'custom' })),
    ]
    const q = squash(value)
    if (!q || presets.some((p) => p.name === value) || inUse.includes(value)) return all
    return all.filter((s) => squash(s.label).includes(q) || (s.group !== 'custom' && squash(s.detail ?? '').startsWith(q)))
  }, [value, presets, inUse])

  const pick = (v: string) => {
    onChange(v)
    onCommit?.(v)
    setOpen(false)
    setActive(-1)
  }

  return (
    <div className={cn('relative', className)}>
      <input
        id={id}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className={inputClass}
        role="combobox"
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => {
          setOpen(false)
          onCommit?.(value)
        }}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setActive(e.target.value.trim() ? 0 : -1)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            if (!open) return setOpen(true)
            const d = e.key === 'ArrowDown' ? 1 : -1
            setActive((a) => Math.max(-1, Math.min(items.length - 1, a + d)))
          } else if (e.key === 'Enter') {
            if (open && active >= 0 && items[active]) {
              e.preventDefault()
              e.stopPropagation()
              pick(items[active].value)
            } else {
              setOpen(false)
              onCommit?.(value)
            }
          } else if (e.key === 'Escape' && open) {
            e.preventDefault()
            e.stopPropagation()
            setOpen(false)
          }
        }}
      />
      {open && <SuggestionList items={items} active={active} onHover={setActive} onPick={(s) => pick(s.value)} />}
    </div>
  )
}
