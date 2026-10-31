import { X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { cn, fold } from '@/lib/utils'
import { SuggestionList } from './Suggestions'

interface Props {
  value: string[]
  onChange: (tags: string[]) => void
  suggestions: string[]
  placeholder?: string
  className?: string
  id?: string
}

export function TagInput({ value, onChange, suggestions, placeholder = 'Add tags…', className, id }: Props) {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)

  const has = (t: string) => value.some((v) => v.toLowerCase() === t.toLowerCase())
  const items = useMemo(() => {
    const q = fold(text.trim())
    return suggestions
      .filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()))
      .filter((s) => !q || fold(s).includes(q))
      .slice(0, 8)
      .map((s) => ({ value: s, label: s }))
  }, [text, suggestions, value])

  const add = (raw: string) => {
    const tags = raw
      .split(',')
      .map((t) => t.replace(/^#/, '').trim())
      .filter((t) => t && !has(t))
    if (tags.length) onChange([...value, ...tags])
    setText('')
    setActive(-1)
  }

  return (
    <div
      className={cn(
        'relative flex min-h-7 w-full flex-wrap items-center gap-1 rounded-md border border-border-strong bg-bg-elevated px-1 py-[3px] shadow-xs transition-[box-shadow,border-color] focus-within:border-accent focus-within:ring-[3px] focus-within:ring-ring',
        className,
      )}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault()
          inputRef.current?.focus()
        }
      }}
    >
      {value.map((t) => (
        <span key={t} className="inline-flex h-5 items-center gap-0.5 rounded bg-accent-soft pl-1.5 pr-0.5 text-xs font-medium text-fg">
          {t}
          <button
            tabIndex={-1}
            aria-label={`Remove ${t}`}
            className="grid size-4 place-items-center rounded-sm text-fg-muted hover:bg-bg-hover hover:text-fg"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChange(value.filter((v) => v !== t))}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        id={id}
        value={text}
        placeholder={value.length ? '' : placeholder}
        autoComplete="off"
        spellCheck={false}
        className="h-5 min-w-[70px] flex-1 bg-transparent px-1 text-[13px] outline-none placeholder:text-fg-faint"
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false)
          if (text.trim()) add(text)
        }}
        onChange={(e) => {
          const v = e.target.value
          if (v.endsWith(',')) return add(v)
          setText(v)
          setOpen(true)
          setActive(v.trim() ? 0 : -1)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setOpen(true)
            const d = e.key === 'ArrowDown' ? 1 : -1
            setActive((a) => Math.max(-1, Math.min(items.length - 1, a + d)))
          } else if (e.key === 'Enter' || (e.key === 'Tab' && text.trim())) {
            const chosen = open && active >= 0 ? items[active]?.value : undefined
            if (chosen || text.trim()) {
              e.preventDefault()
              e.stopPropagation()
              add(chosen ?? text)
            }
          } else if (e.key === 'Backspace' && !text && value.length) {
            onChange(value.slice(0, -1))
          } else if (e.key === 'Escape' && (open || text)) {
            e.preventDefault()
            e.stopPropagation()
            if (text) setText('')
            else setOpen(false)
          }
        }}
      />
      {open && <SuggestionList items={items} active={active} onHover={setActive} onPick={(s) => add(s.value)} />}
    </div>
  )
}
