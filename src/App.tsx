import { PanelRight, Plus, Search, Star, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AddTabDialog } from './components/AddTabDialog'
import { Inspector } from './components/Inspector'
import { Sidebar } from './components/Sidebar'
import { TabList } from './components/TabList'
import { Toast, type ToastData } from './components/Toast'
import { Button } from './components/ui/button'
import { Kbd } from './components/ui/input'
import { usePersistentState } from './hooks/usePersistentState'
import { api, errorMessage, type Tab, type TabInput, type TuningPreset } from './lib/api'
import { countMatches, filterTabs, fixedSort, sidebarCounts, viewTitle, type Sort, type SortKey, type View } from './lib/library'
import { cn, isMac } from './lib/utils'

const mod = isMac ? '⌘' : 'Ctrl+'
const looksLikeUrl = (s: string) => /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(s.trim())
const isTextInput = (el: Element | null) => !!el && (el.matches('input, textarea, [contenteditable="true"]') || !!el.closest('[role="dialog"]'))

export default function App() {
  const [tabs, setTabs] = useState<Tab[]>([])
  const [presets, setPresets] = useState<TuningPreset[]>([])
  const [loaded, setLoaded] = useState(false)
  const [view, setView] = usePersistentState<View>('riff.view', { kind: 'all' })
  const [sort, setSort] = usePersistentState<Sort>('riff.sort', { key: 'artist', dir: 'asc' })
  const [inspectorOpen, setInspectorOpen] = usePersistentState('riff.inspector', true)
  const [query, setQuery] = useState('')
  const [rawSelectedId, setSelectedId] = useState<number | null>(null)
  const [addState, setAddState] = useState<{ open: boolean; url?: string }>({ open: false })
  const [toast, setToast] = useState<ToastData | null>(null)
  const [flashId, setFlashId] = useState<number | null>(null)
  const [undo, setUndo] = useState<Tab | null>(null)

  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const sidebarRef = useRef<HTMLDivElement>(null)

  const showToast = useCallback((t: Omit<ToastData, 'id'>) => setToast({ ...t, id: Date.now() }), [])
  const dismissToast = useCallback(() => setToast(null), [])
  const fail = useCallback((e: unknown) => showToast({ message: errorMessage(e), tone: 'error' }), [showToast])

  const reload = useCallback(() => api.listTabs().then(setTabs, fail), [fail])
  const replaceTab = (tab: Tab) => setTabs((ts) => (ts.some((t) => t.id === tab.id) ? ts.map((t) => (t.id === tab.id ? tab : t)) : [...ts, tab]))

  // Initial load.
  useEffect(() => {
    Promise.all([api.meta(), api.listTabs()])
      .then(([meta, list]) => {
        setPresets(meta.presets)
        setTabs(list)
      }, fail)
      .finally(() => setLoaded(true))
  }, [fail])

  // Tabs saved from the browser extension / riff:// links.
  useEffect(() => {
    const un = api.onExternalChange(async (change) => {
      const list = await api.listTabs()
      setTabs(list)
      const tab = list.find((t) => t.id === change.tabId)
      if (!tab) return
      setSelectedId(tab.id)
      setFlashId(tab.id)
      showToast({ message: `${change.created ? 'Saved' : 'Updated'} “${tab.title || 'Untitled'}” from your browser` })
    })
    return () => {
      un.then((f) => f())
    }
  }, [showToast])

  const counts = useMemo(() => sidebarCounts(tabs, presets), [tabs, presets])
  const tuningsInUse = useMemo(() => counts.tunings.flatMap((t) => (t.name ? [t.name] : [])), [counts])
  const allTags = useMemo(() => counts.tags.map((t) => t.name), [counts])
  const visible = useMemo(() => filterTabs(tabs, view, query, sort, presets), [tabs, view, query, sort, presets])
  // Keep a selection inside the visible list so ↩ from search opens the top hit.
  const selectedId = visible.some((t) => t.id === rawSelectedId) ? rawSelectedId : (visible[0]?.id ?? null)
  const selected = tabs.find((t) => t.id === selectedId) ?? null

  // A remembered tuning/tag view that no longer exists falls back to All Tabs.
  useEffect(() => {
    if (!loaded) return
    if (view.kind === 'tuning' && !counts.tunings.some((t) => t.name === view.tuning)) setView({ kind: 'all' })
    if (view.kind === 'tag' && !counts.tags.some((t) => t.name.toLowerCase() === view.tag.toLowerCase())) setView({ kind: 'all' })
  }, [loaded, view, counts, setView])

  useEffect(() => {
    if (flashId == null) return
    const t = setTimeout(() => setFlashId(null), 1700)
    return () => clearTimeout(t)
  }, [flashId])

  // ---- actions ------------------------------------------------------------

  const openTab = useCallback(
    (tab: Tab) => {
      api.openTab(tab.id).then(replaceTab, fail)
    },
    [fail],
  )

  const saveTab = useCallback(
    async (input: TabInput) => {
      try {
        const { tab } = await api.saveTab(input)
        replaceTab(tab)
        return true
      } catch (e) {
        fail(e)
        return false
      }
    },
    [fail],
  )

  const toggleFavorite = (tab: Tab) => saveTab({ id: tab.id, favorite: !tab.favorite })

  const deleteTab = (tab: Tab) => {
    const idx = visible.findIndex((t) => t.id === tab.id)
    const neighbour = visible[idx + 1] ?? visible[idx - 1]
    api.deleteTab(tab.id).then(() => {
      setTabs((ts) => ts.filter((t) => t.id !== tab.id))
      setSelectedId(neighbour?.id ?? null)
      setUndo(tab)
      showToast({ message: `Deleted “${tab.title || 'Untitled'}”`, action: { label: 'Undo', run: () => restore(tab) } })
      listRef.current?.focus()
    }, fail)
  }

  const restore = (tab: Tab) => {
    setUndo(null)
    api.restoreTab(tab).then((t) => {
      replaceTab(t)
      setSelectedId(t.id)
      setToast(null)
    }, fail)
  }

  const editTab = (tab: Tab) => {
    setSelectedId(tab.id)
    setInspectorOpen(true)
    requestAnimationFrame(() => titleRef.current?.focus())
  }

  const selectView = (v: View) => {
    setView(v)
    setQuery('')
  }

  const onSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'added' || key === 'opened' ? 'desc' : 'asc' }))

  const focusSearch = (text?: string) => {
    const el = searchRef.current
    if (!el) return
    el.focus()
    if (text != null) setQuery((q) => q + text)
    else el.select()
  }

  const addInitial = {
    url: addState.url,
    tuning: view.kind === 'tuning' ? (view.tuning ?? undefined) : undefined,
    tags: view.kind === 'tag' ? [view.tag] : undefined,
    favorite: view.kind === 'favorites',
  }

  // ---- global shortcuts ---------------------------------------------------

  const handlers = useRef({ toggleFavorite, editTab, restore, selectView, focusSearch })
  useEffect(() => {
    handlers.current = { toggleFavorite, editTab, restore, selectView, focusSearch }
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const h = handlers.current
      const cmd = isMac ? e.metaKey : e.ctrlKey
      const inDialog = !!document.querySelector('[role="dialog"]')
      if (inDialog) return
      const key = e.key.toLowerCase()
      if (cmd && (key === 'f' || key === 'l')) {
        e.preventDefault()
        h.focusSearch()
      } else if (cmd && key === 'n') {
        e.preventDefault()
        setAddState({ open: true })
      } else if (cmd && key === 'd' && selected) {
        e.preventDefault()
        h.toggleFavorite(selected)
      } else if (cmd && key === 'i') {
        e.preventDefault()
        setInspectorOpen((o) => !o)
      } else if (cmd && key === 'e' && selected) {
        e.preventDefault()
        h.editTab(selected)
      } else if (cmd && ['1', '2', '3', '4'].includes(key)) {
        e.preventDefault()
        const views: View[] = [{ kind: 'all' }, { kind: 'recent-added' }, { kind: 'recent-opened' }, { kind: 'favorites' }]
        h.selectView(views[Number(key) - 1])
      } else if (cmd && key === 'z' && !e.shiftKey && undo && !isTextInput(document.activeElement)) {
        e.preventDefault()
        h.restore(undo)
      } else if (key === '/' && !isTextInput(document.activeElement)) {
        e.preventDefault()
        h.focusSearch()
      }
    }
    const onPaste = (e: ClipboardEvent) => {
      if (isTextInput(document.activeElement)) return
      const text = e.clipboardData?.getData('text/plain') ?? ''
      if (looksLikeUrl(text)) {
        e.preventDefault()
        setAddState({ open: true, url: text.trim() })
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('paste', onPaste)
    }
  }, [selected, undo, setInspectorOpen])

  // ---- render -------------------------------------------------------------

  const title = viewTitle(view)
  const empty = (() => {
    if (!loaded) return null
    if (tabs.length === 0) return <LibraryEmpty onAdd={() => setAddState({ open: true })} />
    if (query.trim()) {
      const elsewhere = view.kind !== 'all' ? countMatches(tabs, query) : 0
      return (
        <EmptyState title={`No matches for “${query.trim()}”`} body={view.kind === 'all' ? 'Try a different song, artist, tuning or tag.' : `Nothing in ${title} matches.`}>
          {elsewhere > 0 && (
            <Button variant="secondary" onClick={() => setView({ kind: 'all' })}>
              Show {elsewhere} {elsewhere === 1 ? 'match' : 'matches'} in All Tabs
            </Button>
          )}
        </EmptyState>
      )
    }
    if (view.kind === 'favorites')
      return (
        <EmptyState title="No favorites yet" body={`Click the star next to a tab, or press ${mod}D, to keep it here.`}>
          <Star className="size-5 text-star" />
        </EmptyState>
      )
    if (view.kind === 'recent-opened') return <EmptyState title="Nothing opened yet" body="Tabs you open from Riff will show up here." />
    return <EmptyState title="No tabs here" body="" />
  })()

  return (
    <div className="flex h-full">
      <div ref={sidebarRef} className="w-[212px] shrink-0">
        <Sidebar
          counts={counts}
          view={view}
          onSelect={selectView}
          onRenameTag={(from, to) => {
            api.renameTag(from, to).then(() => {
              if (view.kind === 'tag' && view.tag === from) setView({ kind: 'tag', tag: to })
              return reload()
            }, fail)
          }}
          onDeleteTag={(name) => {
            api.deleteTag(name).then(() => {
              if (view.kind === 'tag' && view.tag === name) setView({ kind: 'all' })
              return reload()
            }, fail)
          }}
          onExit={() => listRef.current?.focus()}
        />
      </div>

      <main className="flex min-w-0 flex-1 flex-col border-l border-border bg-bg">
        <header data-tauri-drag-region className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border pl-4 pr-3">
          <div data-tauri-drag-region className="min-w-0 flex-1">
            <h1 data-tauri-drag-region className="truncate text-[15px] font-semibold leading-tight">
              {title}
            </h1>
            <p data-tauri-drag-region className="text-[11px] leading-tight text-fg-faint">
              {loaded && `${visible.length} ${visible.length === 1 ? 'tab' : 'tabs'}`}
            </p>
          </div>

          <div className="relative w-[min(280px,40%)]">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-fg-faint" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={view.kind === 'all' ? 'Search songs, artists, tags' : `Search ${title}`}
              spellCheck={false}
              autoComplete="off"
              aria-label="Search"
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  if (query) setQuery('')
                  else listRef.current?.focus()
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  listRef.current?.focus()
                  const i = visible.findIndex((t) => t.id === selectedId)
                  if (i >= 0 && visible[i + 1] && query === '') setSelectedId(visible[i + 1].id)
                } else if (e.key === 'Enter' && selected) {
                  e.preventDefault()
                  openTab(selected)
                }
              }}
              className="h-7 w-full rounded-md border border-transparent bg-bg-subtle pl-7 pr-7 text-[13px] outline-none ring-1 ring-inset ring-border placeholder:text-fg-faint focus:border-accent focus:bg-bg-elevated focus:ring-[3px] focus:ring-ring"
            />
            {query ? (
              <button
                aria-label="Clear search"
                onClick={() => {
                  setQuery('')
                  searchRef.current?.focus()
                }}
                className="absolute right-1.5 top-1/2 grid size-4 -translate-y-1/2 place-items-center rounded-full bg-fg-faint/60 text-bg hover:bg-fg-muted"
              >
                <X className="size-2.5" strokeWidth={3} />
              </button>
            ) : (
              <Kbd className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2">{mod}F</Kbd>
            )}
          </div>

          <Button variant="ghost" size="icon" title={`Add Tab (${mod}N)`} aria-label="Add tab" onClick={() => setAddState({ open: true })}>
            <Plus />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title={`${inspectorOpen ? 'Hide' : 'Show'} Details (${mod}I)`}
            aria-label="Toggle details"
            aria-pressed={inspectorOpen}
            onClick={() => setInspectorOpen((o) => !o)}
            className={cn(inspectorOpen && 'text-fg')}
          >
            <PanelRight />
          </Button>
        </header>

        <div className="flex min-h-0 flex-1">
          <TabList
            ref={listRef}
            tabs={visible}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onOpen={openTab}
            onToggleFavorite={toggleFavorite}
            onDelete={deleteTab}
            onEdit={editTab}
            onTypeAhead={(c) => focusSearch(c)}
            onExitLeft={() => sidebarRef.current?.querySelector<HTMLElement>('button[aria-current="page"]')?.focus()}
            sort={fixedSort(view) ?? sort}
            onSort={fixedSort(view) ? null : onSort}
            dateColumn={view.kind === 'recent-opened' ? 'opened' : 'added'}
            flashId={flashId}
            empty={empty}
          />
          {inspectorOpen && tabs.length > 0 && (
            <div className="w-[290px] shrink-0 border-l border-border bg-bg">
              <Inspector
                key={selected?.id ?? 'none'}
                ref={titleRef}
                tab={selected}
                presets={presets}
                tuningsInUse={tuningsInUse}
                allTags={allTags}
                onSave={saveTab}
                onOpen={openTab}
                onDelete={deleteTab}
                onDone={() => listRef.current?.focus()}
              />
            </div>
          )}
        </div>
      </main>

      <AddTabDialog
        open={addState.open}
        onOpenChange={(open) => {
          setAddState((s) => ({ ...s, open }))
          if (!open) requestAnimationFrame(() => listRef.current?.focus())
        }}
        initial={addInitial}
        presets={presets}
        tuningsInUse={tuningsInUse}
        allTags={allTags}
        onSaved={(tab, created) => {
          replaceTab(tab)
          if (!visible.some((t) => t.id === tab.id) && !created) setView({ kind: 'all' })
          setQuery('')
          setSelectedId(tab.id)
          setFlashId(tab.id)
          if (!created) showToast({ message: `Updated “${tab.title || 'Untitled'}”` })
        }}
        onShowExisting={(tab) => {
          setView({ kind: 'all' })
          setQuery('')
          setSelectedId(tab.id)
          setFlashId(tab.id)
        }}
      />

      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  )
}

function EmptyState({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-1.5 px-6 text-center">
      <p className="text-[15px] font-medium text-fg-muted">{title}</p>
      {body && <p className="max-w-xs text-xs text-fg-faint">{body}</p>}
      {children && <div className="mt-2">{children}</div>}
    </div>
  )
}

function LibraryEmpty({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent">
        <svg viewBox="0 0 24 24" className="size-7" fill="currentColor" aria-hidden>
          <path d="M12 2.5c-4.6 0-8.5 1.9-8.5 5.6 0 4.6 5.3 11.8 7.4 13.4.7.5 1.5.5 2.2 0 2.1-1.6 7.4-8.8 7.4-13.4 0-3.7-3.9-5.6-8.5-5.6Z" />
        </svg>
      </div>
      <p className="text-[17px] font-semibold">Your tab library is empty</p>
      <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-fg-muted">
        Click the Riff button in your browser while viewing a tab and it lands here. You can also paste a link anywhere in this window ({mod}V).
      </p>
      <Button className="mt-5" onClick={onAdd}>
        <Plus /> Add Your First Tab
      </Button>
    </div>
  )
}
