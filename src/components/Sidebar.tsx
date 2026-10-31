import { Clock, Guitar, Hash, History, Pencil, Star, Trash2 } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import type { SidebarCounts, View } from '@/lib/library'
import { sameView } from '@/lib/library'
import { cn } from '@/lib/utils'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from './ui/context-menu'

/** Six strings — used as the tuning glyph. */
function StringsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeLinecap="round">
      {[3, 6.33, 9.67, 13].map((y, i) => (
        <line key={y} x1="2" x2="14" y1={y} y2={y} strokeWidth={1.6 - i * 0.25} />
      ))}
    </svg>
  )
}

interface Props {
  counts: SidebarCounts
  view: View
  onSelect: (v: View) => void
  onRenameTag: (from: string, to: string) => void
  onDeleteTag: (name: string) => void
  /** Called when the user presses → or Tab to move into the list. */
  onExit: () => void
}

export function Sidebar({ counts, view, onSelect, onRenameTag, onDeleteTag, onExit }: Props) {
  const [renaming, setRenaming] = useState<string | null>(null)

  const item = (v: View, icon: ReactNode, label: ReactNode, count?: number, key?: string) => (
    <SidebarItem key={key} active={sameView(v, view)} icon={icon} label={label} count={count} onClick={() => onSelect(v)} />
  )

  return (
    <nav
      className="flex h-full flex-col"
      aria-label="Library"
      onKeyDown={(e) => {
        if (renaming) return
        const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-nav]')]
        const idx = buttons.indexOf(document.activeElement as HTMLButtonElement)
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          const next = buttons[Math.max(0, Math.min(buttons.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1)))]
          next?.focus()
          next?.click()
        } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
          e.preventDefault()
          onExit()
        }
      }}
    >
      <div data-tauri-drag-region className="h-[52px] shrink-0" />
      <div className="flex-1 space-y-4 overflow-y-auto px-2.5 pb-4">
        <Section title="Library">
          {item({ kind: 'all' }, <Guitar />, 'All Tabs', counts.all)}
          {item({ kind: 'recent-added' }, <Clock />, 'Recently Added')}
          {item({ kind: 'recent-opened' }, <History />, 'Recently Opened', counts.opened || undefined)}
          {item({ kind: 'favorites' }, <Star />, 'Favorites', counts.favorites || undefined)}
        </Section>

        <Section title="Tunings">
          {counts.tunings.length === 0 && <p className="px-2 py-1 text-xs text-fg-faint">Tunings appear here as you add tabs.</p>}
          {counts.tunings.map((t) =>
            item(
              { kind: 'tuning', tuning: t.name },
              <StringsIcon />,
              t.name ?? <span className="italic text-fg-muted">No Tuning</span>,
              t.count,
              t.name ?? '__none',
            ),
          )}
        </Section>

        {counts.tags.length > 0 && (
          <Section title="Tags">
            {counts.tags.map((t) =>
              renaming === t.name ? (
                <RenameField
                  key={t.name}
                  initial={t.name}
                  onDone={(to) => {
                    setRenaming(null)
                    if (to && to !== t.name) onRenameTag(t.name, to)
                  }}
                />
              ) : (
                <ContextMenu key={t.name}>
                  <ContextMenuTrigger asChild>
                    <div onDoubleClick={() => setRenaming(t.name)}>
                      {item({ kind: 'tag', tag: t.name }, <Hash />, t.name, t.count)}
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onSelect={() => setRenaming(t.name)}>
                      <Pencil /> Rename Tag…
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem destructive onSelect={() => onDeleteTag(t.name)}>
                      <Trash2 /> Remove Tag from {t.count} {t.count === 1 ? 'Tab' : 'Tabs'}
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ),
            )}
          </Section>
        )}
      </div>
    </nav>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="px-2 pb-1 text-[11px] font-semibold text-fg-faint">{title}</h2>
      <div className="space-y-px">{children}</div>
    </div>
  )
}

function SidebarItem({ active, icon, label, count, onClick }: { active: boolean; icon: ReactNode; label: ReactNode; count?: number; onClick: () => void }) {
  return (
    <button
      data-nav
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-accent',
        active ? 'bg-bg-sidebar-selected font-medium' : 'hover:bg-bg-hover',
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count != null && <span className="text-xs tabular-nums text-fg-faint">{count}</span>}
    </button>
  )
}

function RenameField({ initial, onDone: done }: { initial: string; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(initial)
  const finished = useRef(false)
  const onDone = (x: string | null) => {
    if (finished.current) return
    finished.current = true
    done(x)
  }
  return (
    <div className="flex h-7 items-center gap-2 px-2 [&_svg]:size-4 [&_svg]:text-accent">
      <Hash />
      <input
        autoFocus
        value={v}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => onDone(v.trim() || null)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') onDone(v.trim() || null)
          if (e.key === 'Escape') onDone(null)
        }}
        className="h-6 min-w-0 flex-1 rounded border border-accent bg-bg-elevated px-1.5 text-[13px] outline-none ring-[3px] ring-ring"
      />
    </div>
  )
}
