import type { Tab, TuningPreset } from './api'
import { fold } from './utils'

export type View =
  | { kind: 'all' }
  | { kind: 'recent-added' }
  | { kind: 'recent-opened' }
  | { kind: 'favorites' }
  | { kind: 'tuning'; tuning: string | null }
  | { kind: 'tag'; tag: string }

export type SortKey = 'title' | 'artist' | 'tuning' | 'added' | 'opened'
export interface Sort {
  key: SortKey
  dir: 'asc' | 'desc'
}

const RECENT_LIMIT = 50

export function viewTitle(v: View): string {
  switch (v.kind) {
    case 'all':
      return 'All Tabs'
    case 'recent-added':
      return 'Recently Added'
    case 'recent-opened':
      return 'Recently Opened'
    case 'favorites':
      return 'Favorites'
    case 'tuning':
      return v.tuning ?? 'No Tuning'
    case 'tag':
      return v.tag
  }
}

export function sameView(a: View, b: View): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'tuning' && b.kind === 'tuning') return a.tuning === b.tuning
  if (a.kind === 'tag' && b.kind === 'tag') return a.tag.toLowerCase() === b.tag.toLowerCase()
  return true
}

/** Recent views have a fixed, date-based order. */
export function fixedSort(v: View): Sort | null {
  if (v.kind === 'recent-added') return { key: 'added', dir: 'desc' }
  if (v.kind === 'recent-opened') return { key: 'opened', dir: 'desc' }
  return null
}

export function inView(tab: Tab, v: View): boolean {
  switch (v.kind) {
    case 'all':
    case 'recent-added':
      return true
    case 'recent-opened':
      return tab.lastOpenedAt != null
    case 'favorites':
      return tab.favorite
    case 'tuning':
      return tab.tuning === v.tuning
    case 'tag':
      return tab.tags.some((t) => t.toLowerCase() === v.tag.toLowerCase())
  }
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

function compare(a: Tab, b: Tab, key: SortKey, presetRank: Map<string, number>): number {
  const text = (x: string, y: string) => {
    // Blank values sort last regardless of direction feels odd; keep them last in asc.
    if (!x && y) return 1
    if (x && !y) return -1
    return collator.compare(x.replace(/^the\s+/i, ''), y.replace(/^the\s+/i, ''))
  }
  switch (key) {
    case 'title':
      return text(a.title, b.title) || text(a.artist, b.artist)
    case 'artist':
      return text(a.artist, b.artist) || text(a.title, b.title)
    case 'tuning': {
      const ra = a.tuning ? (presetRank.get(a.tuning) ?? 999) : 1000
      const rb = b.tuning ? (presetRank.get(b.tuning) ?? 999) : 1000
      return ra - rb || text(a.tuning ?? '', b.tuning ?? '') || text(a.artist, b.artist) || text(a.title, b.title)
    }
    case 'added':
      return a.createdAt - b.createdAt
    case 'opened':
      return (a.lastOpenedAt ?? 0) - (b.lastOpenedAt ?? 0)
  }
}

function matches(tab: Tab, tokens: string[]): boolean {
  if (tokens.length === 0) return true
  const hay = fold([tab.title, tab.artist, tab.tuning ?? '', ...tab.tags].join(' \u0001 '))
  return tokens.every((t) => hay.includes(t))
}

export function searchTokens(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean)
}

export function filterTabs(tabs: Tab[], view: View, query: string, sort: Sort, presets: TuningPreset[]): Tab[] {
  const tokens = searchTokens(query)
  const rank = new Map(presets.map((p, i) => [p.name, i]))
  const effective = fixedSort(view) ?? sort
  let out = tabs.filter((t) => inView(t, view) && matches(t, tokens))
  out.sort((a, b) => {
    const c = compare(a, b, effective.key, rank)
    return effective.dir === 'asc' ? c : -c
  })
  if (view.kind === 'recent-added' || view.kind === 'recent-opened') out = out.slice(0, RECENT_LIMIT)
  return out
}

export function countMatches(tabs: Tab[], query: string): number {
  const tokens = searchTokens(query)
  return tabs.filter((t) => matches(t, tokens)).length
}

export interface SidebarCounts {
  all: number
  favorites: number
  opened: number
  tunings: { name: string | null; count: number }[]
  tags: { name: string; count: number }[]
}

export function sidebarCounts(tabs: Tab[], presets: TuningPreset[]): SidebarCounts {
  const tunings = new Map<string | null, number>()
  const tags = new Map<string, { name: string; count: number }>()
  for (const t of tabs) {
    tunings.set(t.tuning, (tunings.get(t.tuning) ?? 0) + 1)
    for (const tag of t.tags) {
      const k = tag.toLowerCase()
      const e = tags.get(k)
      if (e) e.count++
      else tags.set(k, { name: tag, count: 1 })
    }
  }
  const rank = new Map(presets.map((p, i) => [p.name, i]))
  const tuningList = [...tunings.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => {
      const ra = a.name == null ? 10_000 : (rank.get(a.name) ?? 1000)
      const rb = b.name == null ? 10_000 : (rank.get(b.name) ?? 1000)
      return ra - rb || collator.compare(a.name ?? '', b.name ?? '')
    })
  return {
    all: tabs.length,
    favorites: tabs.filter((t) => t.favorite).length,
    opened: tabs.filter((t) => t.lastOpenedAt != null).length,
    tunings: tuningList,
    tags: [...tags.values()].sort((a, b) => collator.compare(a.name, b.name)),
  }
}

// ---- transposing for the player's tuning ---------------------------------
// Mirrors tuning::fret_shift in src-tauri/src/tuning.rs, which is what Tab
// Transposer actually gets. Stored tunings are canonical: a preset name or
// space-separated notes ("C G C G G C").

const PITCH: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

function pitchClasses(tuning: string, presets: TuningPreset[]): number[] | null {
  const notes = (presets.find((p) => p.name === tuning)?.notes ?? tuning).trim().split(/\s+/)
  if (notes.length < 4 || notes.length > 8) return null
  const out: number[] = []
  for (const n of notes) {
    const m = /^([A-G])([#b]?)$/.exec(n)
    if (!m) return null
    out.push((PITCH[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12)
  }
  return out
}

/** Lowest string's pitch, in the octave nearest a standard instrument with as many strings. */
function lowestPitch(pcs: number[]): number {
  const reference = ({ 4: 28, 5: 23, 7: 35, 8: 30 } as Record<number, number>)[pcs.length] ?? 40
  const top = reference + 3
  return top - (((top - pcs[0]) % 12) + 12) % 12
}

/**
 * Frets to move a tab written in `tab` so it plays in `play` (positive = up),
 * or null when the strings don't all differ by the same amount.
 */
export function fretShift(tab: string, play: string, presets: TuningPreset[]): number | null {
  const from = pitchClasses(tab, presets)
  const to = pitchClasses(play, presets)
  if (!from || !to || from.length !== to.length) return null
  const shift = lowestPitch(from) - lowestPitch(to)
  if (!from.every((pc, i) => (((pc - to[i] - shift) % 12) + 12) % 12 === 0)) return null
  return shift > 10 ? shift - 12 : shift < -10 ? shift + 12 : shift
}

/** "Up 1 step", "Down ½ step", "Up 2½ steps". */
export function stepLabel(frets: number): string {
  const n = Math.abs(frets)
  const whole = Math.floor(n / 2)
  const amount = whole === 0 ? '½' : `${whole}${n % 2 ? '½' : ''}`
  return `${frets > 0 ? 'Up' : 'Down'} ${amount} ${n <= 2 ? 'step' : 'steps'}`
}
