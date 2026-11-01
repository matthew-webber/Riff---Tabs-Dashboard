import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { mock } from './mock'

export interface Tab {
  id: number
  url: string
  title: string
  artist: string
  tuning: string | null
  favorite: boolean
  tags: string[]
  createdAt: number
  updatedAt: number
  lastOpenedAt: number | null
  openCount: number
}

/** On update, omitted fields are left unchanged. */
export interface TabInput {
  id?: number
  url?: string
  title?: string
  artist?: string
  tuning?: string
  tags?: string[]
  favorite?: boolean
}

export interface TuningPreset {
  name: string
  notes: string
}

export interface Meta {
  presets: TuningPreset[]
  apiPort: number
}

export interface ExternalChange {
  kind: 'saved' | 'removed'
  /** The saved tab, or the tab as it was just before removal. */
  tab: Tab
  created: boolean
  source: 'extension' | 'link'
}

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

const tauri = {
  meta: () => invoke<Meta>('get_meta'),
  listTabs: () => invoke<Tab[]>('list_tabs'),
  lookupUrl: (url: string) => invoke<Tab | null>('lookup_url', { url }),
  saveTab: (input: TabInput) => invoke<{ tab: Tab; created: boolean }>('save_tab', { input }),
  restoreTab: (tab: Tab) => invoke<Tab>('restore_tab', { tab }),
  deleteTab: (id: number) => invoke<void>('delete_tab', { id }),
  openTab: (id: number) => invoke<Tab>('open_tab', { id }),
  renameTag: (from: string, to: string) => invoke<void>('rename_tag', { from, to }),
  deleteTag: (name: string) => invoke<void>('delete_tag', { name }),
}

export const api = {
  ...(isTauri ? tauri : mock),
  onExternalChange: (cb: (c: ExternalChange) => void): Promise<UnlistenFn> =>
    isTauri ? listen<ExternalChange>('library-changed', (e) => cb(e.payload)) : Promise.resolve(() => {}),
}

export function errorMessage(e: unknown): string {
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  return 'Something went wrong'
}
