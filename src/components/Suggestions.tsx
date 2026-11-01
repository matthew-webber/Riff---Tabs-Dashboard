import { Fragment, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

export interface Suggestion {
  value: string
  label: string
  detail?: string
  /** A separator is drawn wherever consecutive items change group. */
  group?: string
}

/** Dropdown list shared by the tuning and tag inputs. Never takes focus. */
export function SuggestionList({ items, active, onPick, onHover, className }: { items: Suggestion[]; active: number; onPick: (s: Suggestion) => void; onHover: (i: number) => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])
  if (items.length === 0) return null
  return (
    <div
      ref={ref}
      role="listbox"
      className={cn('absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-lg border border-border bg-bg-elevated p-1 shadow-pop animate-pop-in', className)}
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((s, i) => (
        <Fragment key={s.value}>
          {i > 0 && s.group !== items[i - 1].group && <div role="separator" className="mx-1 my-1 h-px bg-border" />}
          <div
            role="option"
            aria-selected={i === active}
            data-index={i}
            onMouseEnter={() => onHover(i)}
            onClick={() => onPick(s)}
            className={cn('flex h-6 items-center gap-2 rounded-[5px] px-2 text-[13px]', i === active && 'bg-accent text-accent-fg')}
          >
            <span className="truncate">{s.label}</span>
            {s.detail && <span className={cn('ml-auto shrink-0 font-mono text-[11px] text-fg-faint', i === active && 'text-accent-fg/75')}>{s.detail}</span>}
          </div>
        </Fragment>
      ))}
    </div>
  )
}
