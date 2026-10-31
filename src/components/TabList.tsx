import { ChevronDown, ChevronUp, Copy, ExternalLink, Pencil, Star, Trash2 } from 'lucide-react'
import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Tab } from '@/lib/api'
import type { Sort, SortKey } from '@/lib/library'
import { cn, fullDate, isMac, relativeDate } from '@/lib/utils'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from './ui/context-menu'

const mod = isMac ? '⌘' : 'Ctrl+'

interface Props {
  tabs: Tab[]
  selectedId: number | null
  onSelect: (id: number) => void
  onOpen: (tab: Tab) => void
  onToggleFavorite: (tab: Tab) => void
  onDelete: (tab: Tab) => void
  onEdit: (tab: Tab) => void
  /** Printable key pressed while the list has focus: hand it to search. */
  onTypeAhead: (char: string) => void
  /** ← or Shift-Tab out of the list. */
  onExitLeft: () => void
  sort: Sort
  onSort: ((key: SortKey) => void) | null
  dateColumn: 'added' | 'opened'
  flashId: number | null
  empty: ReactNode
}

const COLS = 'grid grid-cols-[28px_minmax(0,2fr)_minmax(0,1.4fr)_minmax(90px,130px)_minmax(0,1fr)_92px] @max-[720px]:grid-cols-[28px_minmax(0,2fr)_minmax(0,1.4fr)_minmax(90px,130px)_0px_92px] @max-[560px]:grid-cols-[28px_minmax(0,2fr)_minmax(0,1.4fr)_minmax(90px,130px)_0px_0px]'

export const TabList = forwardRef<HTMLDivElement, Props>(function TabList(props, ref) {
  const { tabs, selectedId, onSelect, onOpen, onToggleFavorite, onDelete, onEdit, onTypeAhead, onExitLeft, sort, onSort, dateColumn, flashId, empty } = props
  const scrollRef = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState(false)
  const selected = tabs.find((t) => t.id === selectedId) ?? null

  // Keep the selected row visible.
  useEffect(() => {
    if (selectedId == null) return
    scrollRef.current?.querySelector(`[data-id="${selectedId}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selectedId, tabs])

  const move = (delta: number | 'start' | 'end') => {
    if (!tabs.length) return
    const idx = tabs.findIndex((t) => t.id === selectedId)
    let next: number
    if (delta === 'start') next = 0
    else if (delta === 'end') next = tabs.length - 1
    else if (idx < 0) next = delta > 0 ? 0 : tabs.length - 1
    else next = Math.max(0, Math.min(tabs.length - 1, idx + delta))
    onSelect(tabs[next].id)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const cmd = e.metaKey || e.ctrlKey
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 300) / 30) - 1)
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        return move(cmd ? 'end' : 1)
      case 'ArrowUp':
        e.preventDefault()
        return move(cmd ? 'start' : -1)
      case 'PageDown':
        e.preventDefault()
        return move(page)
      case 'PageUp':
        e.preventDefault()
        return move(-page)
      case 'Home':
        e.preventDefault()
        return move('start')
      case 'End':
        e.preventDefault()
        return move('end')
      case 'ArrowLeft':
        e.preventDefault()
        return onExitLeft()
      case 'Enter':
        if (selected) {
          e.preventDefault()
          if (cmd) onEdit(selected)
          else onOpen(selected)
        }
        return
      case 'Backspace':
      case 'Delete':
        if (selected && (cmd || e.key === 'Delete')) {
          e.preventDefault()
          onDelete(selected)
        }
        return
    }
    if (e.key.length === 1 && !cmd && !e.altKey && e.key !== ' ') {
      e.preventDefault()
      onTypeAhead(e.key)
    }
  }

  const header = (key: SortKey | null, label: string, className?: string) => {
    const activeSort = key && sort.key === key
    const clickable = key && onSort
    return (
      <button
        tabIndex={-1}
        disabled={!clickable}
        onClick={() => key && onSort?.(key)}
        className={cn('flex h-full min-w-0 items-center gap-0.5 px-2 text-left text-[11px] font-medium text-fg-muted', clickable && 'hover:text-fg', activeSort && 'text-fg', className)}
      >
        <span className="truncate">{label}</span>
        {activeSort && (sort.dir === 'asc' ? <ChevronUp className="size-3 shrink-0" /> : <ChevronDown className="size-3 shrink-0" />)}
      </button>
    )
  }

  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      <div className={cn(COLS, 'h-7 shrink-0 border-b border-border px-2')}>
        <span />
        {header('title', 'Title')}
        {header('artist', 'Artist')}
        {header('tuning', 'Tuning')}
        {header(null, 'Tags', 'overflow-hidden')}
        {header(dateColumn, dateColumn === 'added' ? 'Added' : 'Opened', 'overflow-hidden')}
      </div>

      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={(el) => {
              scrollRef.current = el
              if (typeof ref === 'function') ref(el)
              else if (ref) ref.current = el
            }}
            role="listbox"
            aria-label="Tabs"
            aria-activedescendant={selectedId != null ? `tab-${selectedId}` : undefined}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            className="min-h-0 flex-1 overflow-y-auto px-2 py-1 outline-none"
          >
            {tabs.length === 0 ? (
              empty
            ) : (
              tabs.map((tab, i) => {
                const isSel = tab.id === selectedId
                const strong = isSel && focused
                return (
                  <div
                    key={tab.id}
                    id={`tab-${tab.id}`}
                    data-id={tab.id}
                    role="option"
                    aria-selected={isSel}
                    onMouseDown={() => onSelect(tab.id)}
                    onContextMenu={() => onSelect(tab.id)}
                    onDoubleClick={() => onOpen(tab)}
                    className={cn(
                      COLS,
                      'h-[30px] items-center rounded-md',
                      !isSel && i % 2 === 1 && 'bg-bg-row-alt',
                      strong ? 'bg-accent text-accent-fg' : isSel && 'bg-bg-selected-inactive',
                      flashId === tab.id && !isSel && 'animate-flash',
                    )}
                  >
                    <button
                      tabIndex={-1}
                      aria-label={tab.favorite ? 'Remove from favorites' : 'Add to favorites'}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => onToggleFavorite(tab)}
                      className={cn(
                        'grid h-full place-items-center',
                        tab.favorite ? (strong ? 'text-accent-fg' : 'text-star') : cn('opacity-0 hover:opacity-100', strong ? 'text-accent-fg/70' : 'text-fg-faint'),
                      )}
                    >
                      <Star className="size-3.5" fill={tab.favorite ? 'currentColor' : 'none'} />
                    </button>
                    <span className={cn('truncate px-2 font-medium', !tab.title && 'italic font-normal opacity-60')}>{tab.title || 'Untitled'}</span>
                    <span className={cn('truncate px-2', strong ? 'text-accent-fg/90' : 'text-fg-muted')}>{tab.artist}</span>
                    <span className="min-w-0 px-2">
                      {tab.tuning ? (
                        <span
                          className={cn(
                            'inline-block max-w-full truncate rounded px-1.5 py-px text-[11px] font-medium',
                            strong ? 'bg-white/20 text-accent-fg' : 'bg-bg-subtle text-fg-muted ring-1 ring-inset ring-border',
                          )}
                        >
                          {tab.tuning}
                        </span>
                      ) : (
                        <span className={cn('text-xs', strong ? 'text-accent-fg/60' : 'text-fg-faint')}>—</span>
                      )}
                    </span>
                    <span className={cn('truncate px-2 text-xs', strong ? 'text-accent-fg/85' : 'text-fg-muted')}>{tab.tags.join(', ')}</span>
                    <span
                      title={fullDate(dateColumn === 'added' ? tab.createdAt : tab.lastOpenedAt)}
                      className={cn('truncate px-2 text-xs tabular-nums', strong ? 'text-accent-fg/85' : 'text-fg-faint')}
                    >
                      {relativeDate(dateColumn === 'added' ? tab.createdAt : tab.lastOpenedAt)}
                    </span>
                  </div>
                )
              })
            )}
          </div>
        </ContextMenuTrigger>
        {selected && (
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => onOpen(selected)} shortcut="↩">
              <ExternalLink /> Open in Browser
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => onEdit(selected)} shortcut={`${mod}↩`}>
              <Pencil /> Edit Details
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => onToggleFavorite(selected)} shortcut={`${mod}D`}>
              <Star /> {selected.favorite ? 'Remove from Favorites' : 'Add to Favorites'}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => navigator.clipboard.writeText(selected.url)}>
              <Copy /> Copy Link
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem destructive onSelect={() => onDelete(selected)} shortcut={`${mod}⌫`}>
              <Trash2 /> Delete
            </ContextMenuItem>
          </ContextMenuContent>
        )}
      </ContextMenu>
    </div>
  )
})
