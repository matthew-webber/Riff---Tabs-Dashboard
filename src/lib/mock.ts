/**
 * In-memory stand-in for the Rust backend so the UI can be developed in a
 * plain browser with `npm run dev`. Not used inside the Tauri app.
 */
import type { Meta, Tab, TabInput } from './api'

const presets = [
  ['Standard', 'E A D G B E'],
  ['Drop D', 'D A D G B E'],
  ['Eb Standard', 'Eb Ab Db Gb Bb Eb'],
  ['D Standard', 'D G C F A D'],
  ['Drop C#', 'C# G# C# F# A# D#'],
  ['Drop C', 'C G C F A D'],
  ['C Standard', 'C F Bb Eb G C'],
  ['Drop B', 'B F# B E G# C#'],
  ['Open G', 'D G D G B D'],
  ['DADGAD', 'D A D G A D'],
  ['A Standard', 'A D G C E A', 'more'],
  ['Double Drop D', 'D A D G B D', 'more'],
  ['Drop Bb', 'Bb F Bb Eb G C', 'more'],
  ['Open A', 'E A E A C# E', 'more'],
].map(([name, notes, group]) => ({ name, notes, common: group !== 'more' }))

const day = 86_400_000
const now = Date.now()
let nextId = 1
const seed: [string, string, string | null, string[], boolean, number, number | null][] = [
  ['Wonderwall', 'Oasis', 'Standard', ['Campfire'], true, 40, 2],
  ['Everlong', 'Foo Fighters', 'Drop D', ['To Learn'], true, 30, 0.2],
  ['Black Hole Sun', 'Soundgarden', 'Drop D', [], false, 20, null],
  ['Enter Sandman', 'Metallica', 'Standard', ['Fun Riffs'], false, 18, 5],
  ['Chop Suey!', 'System of a Down', 'Drop C', ['To Learn'], false, 9, null],
  ['Purple Haze', 'Jimi Hendrix', 'Eb Standard', ['Fun Riffs'], true, 7, 1],
  ['Duality', 'Slipknot', 'Drop B', [], false, 3, null],
  ['Blackbird', 'The Beatles', 'Standard', ['Fingerstyle', 'Campfire'], false, 1, 0.01],
  ['Kashmir', 'Led Zeppelin', 'DADGAD', ['Fun Riffs'], false, 0.5, null],
  ['Untitled draft', '', null, [], false, 0.1, null],
]
const tabs: Tab[] = seed.map(([title, artist, tuning, tags, favorite, age, opened]) => ({
  id: nextId++,
  url: `https://tabs.ultimate-guitar.com/tab/${artist.toLowerCase().replace(/\W+/g, '-')}/${title.toLowerCase().replace(/\W+/g, '-')}-tabs-${1000 + nextId}`,
  title,
  artist,
  tuning,
  favorite,
  tags,
  createdAt: now - age * day,
  updatedAt: now - age * day,
  lastOpenedAt: opened == null ? null : now - opened * day,
  openCount: opened == null ? 0 : 3,
}))

const key = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/[#?].*$/, '').replace(/\/$/, '')
const normTuning = (t?: string) => {
  const s = t?.trim()
  if (!s) return null
  return presets.find((p) => p.name.toLowerCase() === s.toLowerCase() || p.notes.replace(/ /g, '').toLowerCase() === s.replace(/\W/g, '').toLowerCase())?.name ?? s
}
const clone = <T,>(x: T): T => structuredClone(x)
const delay = <T,>(x: T) => new Promise<T>((r) => setTimeout(() => r(clone(x)), 10))

export const mock = {
  meta: () => delay<Meta>({ presets, apiPort: 47813 }),
  listTabs: () => delay(tabs),
  lookupUrl: (url: string) => delay(tabs.find((t) => key(t.url) === key(url)) ?? null),
  saveTab: async (input: TabInput) => {
    const url = input.url?.trim()
    if (url != null && !/^(https?:\/\/)?[\w-]+\.[\w.-]+/.test(url)) throw "That doesn't look like a valid URL"
    let tab = input.id != null ? tabs.find((t) => t.id === input.id) : tabs.find((t) => url && key(t.url) === key(url))
    const created = !tab
    if (!tab) {
      if (!url) throw 'A URL is required'
      tab = { id: nextId++, url: '', title: '', artist: '', tuning: null, favorite: false, tags: [], createdAt: Date.now(), updatedAt: Date.now(), lastOpenedAt: null, openCount: 0 }
      tabs.push(tab)
    }
    if (url != null) tab.url = /^https?:/.test(url) ? url : `https://${url}`
    if (input.title != null) tab.title = input.title.trim()
    if (input.artist != null) tab.artist = input.artist.trim()
    if (input.tuning != null) tab.tuning = normTuning(input.tuning)
    if (input.favorite != null) tab.favorite = input.favorite
    if (input.tags != null) tab.tags = [...new Set(input.tags.map((t) => t.trim()).filter(Boolean))]
    tab.updatedAt = Date.now()
    return delay({ tab, created })
  },
  restoreTab: (tab: Tab) => {
    tabs.push(clone(tab))
    return delay(tab)
  },
  deleteTab: (id: number) => {
    tabs.splice(tabs.findIndex((t) => t.id === id), 1)
    return delay(undefined)
  },
  openTab: (id: number) => {
    const tab = tabs.find((t) => t.id === id)!
    tab.lastOpenedAt = Date.now()
    tab.openCount++
    window.open(tab.url, '_blank', 'noopener')
    return delay(tab)
  },
  renameTag: (from: string, to: string) => {
    for (const t of tabs) t.tags = [...new Set(t.tags.map((x) => (x === from ? to : x)))]
    return delay(undefined)
  },
  deleteTag: (name: string) => {
    for (const t of tabs) t.tags = t.tags.filter((x) => x !== name)
    return delay(undefined)
  },
}
