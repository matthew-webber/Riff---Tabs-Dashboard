import { ExternalLink, Star, Trash2 } from 'lucide-react'
import { forwardRef, useRef, useState, type ReactNode } from 'react'
import type { Tab, TabInput, TuningPreset } from '@/lib/api'
import { describeShifts, stringShifts } from '@/lib/library'
import { cn, fullDate, hostOf } from '@/lib/utils'
import { TagInput } from './TagInput'
import { TuningInput } from './TuningInput'
import { Button } from './ui/button'

interface Props {
  tab: Tab | null
  presets: TuningPreset[]
  tuningsInUse: string[]
  /** The tuning the player is in, for the "opens shifted" hint. */
  playTuning: string | null
  allTags: string[]
  onSave: (input: TabInput) => Promise<boolean>
  onOpen: (tab: Tab) => void
  onDelete: (tab: Tab) => void
  /** Escape from a field: return focus to the list. */
  onDone: () => void
}

/** Right-hand panel for viewing and editing the selected tab. Every field saves on its own. */
export const Inspector = forwardRef<HTMLInputElement, Props>(function Inspector({ tab, presets, tuningsInUse, playTuning, allTags, onSave, onOpen, onDelete, onDone }, titleRef) {
  if (!tab) {
    return (
      <aside className="flex h-full items-center justify-center p-6 text-center text-xs text-fg-faint">
        Select a tab to see and edit its details.
      </aside>
    )
  }
  const save = (patch: Omit<TabInput, 'id'>) => onSave({ id: tab.id, ...patch })

  return (
    <aside
      className="flex h-full flex-col overflow-y-auto"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          ;(document.activeElement as HTMLElement | null)?.blur()
          onDone()
        }
      }}
    >
      <div className="space-y-4 p-4">
        <div className="flex items-start gap-1">
          <div className="min-w-0 flex-1">
            <TextField
              ref={titleRef}
              value={tab.title}
              placeholder="Song title"
              onCommit={(title) => save({ title })}
              className="text-[17px] font-semibold"
            />
            <TextField value={tab.artist} placeholder="Artist" onCommit={(artist) => save({ artist })} className="text-fg-muted" />
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label={tab.favorite ? 'Remove from favorites' : 'Add to favorites'}
            title={tab.favorite ? 'Remove from Favorites' : 'Add to Favorites'}
            onClick={() => save({ favorite: !tab.favorite })}
            className={cn('mt-0.5', tab.favorite && 'text-star hover:text-star')}
          >
            <Star fill={tab.favorite ? 'currentColor' : 'none'} />
          </Button>
        </div>

        <Button className="w-full" onClick={() => onOpen(tab)}>
          <ExternalLink /> Open on {hostOf(tab.url)}
        </Button>

        <Field label="Tuning">
          <TuningField key={tab.id} value={tab.tuning ?? ''} presets={presets} inUse={tuningsInUse} onCommit={(tuning) => save({ tuning })} />
          {playTuning && tab.tuning && <ShiftHint tuning={tab.tuning} playTuning={playTuning} presets={presets} />}
        </Field>

        <Field label="Tags">
          <TagInput key={tab.id} value={tab.tags} suggestions={allTags} onChange={(tags) => save({ tags })} />
        </Field>

        <Field label="Link">
          <UrlField value={tab.url} onCommit={(url) => save({ url })} />
        </Field>

        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-border pt-3 text-xs">
          <dt className="text-fg-faint">Added</dt>
          <dd className="text-fg-muted">{fullDate(tab.createdAt)}</dd>
          <dt className="text-fg-faint">Last opened</dt>
          <dd className="text-fg-muted">
            {fullDate(tab.lastOpenedAt)}
            {tab.openCount > 1 && <span className="text-fg-faint"> · {tab.openCount} times</span>}
          </dd>
        </dl>
      </div>

      <div className="mt-auto flex justify-end p-3">
        <Button variant="ghost" size="sm" className="hover:text-danger" onClick={() => onDelete(tab)}>
          <Trash2 className="size-3.5!" /> Delete
        </Button>
      </div>
    </aside>
  )
})

/** What Tab Transposer will do to this tab, given the tuning set in the sidebar. */
function ShiftHint({ tuning, playTuning, presets }: { tuning: string; playTuning: string; presets: TuningPreset[] }) {
  const shifts = stringShifts(tuning, playTuning, presets)
  const moves = shifts?.some(Boolean) ?? false
  const text =
    shifts == null
      ? `Can’t be matched to ${playTuning}: the tunings have different strings.`
      : moves
        ? `Opens for ${playTuning}: ${describeShifts(shifts)}.`
        : `Already in ${playTuning}.`
  return <p className={cn('pt-0.5 text-[11px]', moves ? 'text-accent' : 'text-fg-faint')}>{text}</p>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium text-fg-faint">{label}</div>
      {children}
    </div>
  )
}

/** Local draft that resyncs from props unless the user is mid-edit. */
function useDraft(value: string) {
  const [draft, setDraft] = useState(value)
  const [editing, setEditing] = useState(false)
  const [lastValue, setLastValue] = useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    if (!editing) setDraft(value)
  }
  return { draft, setDraft, begin: () => setEditing(true), end: () => setEditing(false) }
}

const TextField = forwardRef<HTMLInputElement, { value: string; placeholder: string; onCommit: (v: string) => void; className?: string }>(function TextField(
  { value, placeholder, onCommit, className },
  ref,
) {
  const { draft, setDraft, begin, end } = useDraft(value)
  const cancelled = useRef(false)
  const commit = () => {
    end()
    if (cancelled.current) {
      cancelled.current = false
      return setDraft(value)
    }
    if (draft.trim() !== value) onCommit(draft)
  }
  return (
    <input
      ref={ref}
      value={draft}
      placeholder={placeholder}
      spellCheck={false}
      autoComplete="off"
      onFocus={begin}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') cancelled.current = true
      }}
      className={cn(
        '-mx-1.5 block w-[calc(100%+12px)] rounded-md border border-transparent bg-transparent px-1.5 py-0.5 outline-none placeholder:text-fg-faint placeholder:font-normal hover:border-border focus:border-accent focus:bg-bg-elevated focus:ring-[3px] focus:ring-ring',
        className,
      )}
    />
  )
})

function TuningField({ value, presets, inUse, onCommit }: { value: string; presets: TuningPreset[]; inUse: string[]; onCommit: (v: string) => void }) {
  const { draft, setDraft, begin, end } = useDraft(value)
  return (
    <div onFocus={begin}>
      <TuningInput
        value={draft}
        onChange={setDraft}
        presets={presets}
        inUse={inUse}
        onCommit={(v) => {
          end()
          if (v.trim() !== value) onCommit(v)
        }}
      />
    </div>
  )
}

function UrlField({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const { draft, setDraft, begin, end } = useDraft(value)
  const cancelled = useRef(false)
  return (
    <textarea
      value={draft}
      rows={2}
      spellCheck={false}
      onFocus={begin}
      onChange={(e) => setDraft(e.target.value.replace(/\n/g, ''))}
      onBlur={() => {
        end()
        if (!cancelled.current && draft.trim() && draft.trim() !== value) onCommit(draft.trim())
        else setDraft(value)
        cancelled.current = false
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          ;(e.target as HTMLTextAreaElement).blur()
        }
        if (e.key === 'Escape') cancelled.current = true
      }}
      className="block w-full resize-none break-all rounded-md border border-border-strong bg-bg-elevated px-2 py-1 font-mono text-[11px] text-fg-muted shadow-xs outline-none focus:border-accent focus:text-fg focus:ring-[3px] focus:ring-ring"
    />
  )
}
