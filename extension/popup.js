// The save popup. There's no Save button: whatever is in the form when the
// popup closes gets saved (by background.js), unless the user discards it.

import { extractTabInfo, guessFromTitle } from './extract.js'
import { api, PRESET_TUNINGS } from './riff-api.js'

const $ = (id) => document.getElementById(id)
const fields = ['title', 'artist', 'tuning']

const draft = { tabId: null, url: '', title: '', artist: '', tuning: '', tags: [], favorite: false }
let existing = null // the library entry for this URL, if any
const touched = new Set() // fields the user has edited — never overwrite these
let port = null
let closing = false

// ---------- background connection ----------

function connect() {
  port = chrome.runtime.connect({ name: 'riff-popup' })
  // If the service worker is restarted while the popup is open, reconnect.
  port.onDisconnect.addListener(() => {
    if (!closing) {
      connect()
      push()
    }
  })
}

const norm = (s) => (s || '').trim().toLowerCase()
function unchanged() {
  if (!existing) return false
  return (
    norm(existing.title) === norm(draft.title) &&
    norm(existing.artist) === norm(draft.artist) &&
    norm(existing.tuning) === norm(draft.tuning) &&
    existing.favorite === draft.favorite &&
    existing.tags.map(norm).sort().join('\u0001') === draft.tags.map(norm).sort().join('\u0001')
  )
}

function push() {
  if (!draft.url || !port) return
  port.postMessage({ type: 'draft', draft: { ...draft }, unchanged: unchanged() })
}

function finish() {
  push()
  closing = true
  window.close()
}

function discard() {
  port?.postMessage({ type: 'discard' })
  closing = true
  window.close()
}

// ---------- rendering ----------

function setStatus(text, tone = '') {
  const el = $('status')
  el.textContent = text
  el.className = `status ${tone}`
}

function renderFields() {
  for (const f of fields) if (!touched.has(f)) $(f).value = draft[f]
  $('favorite').setAttribute('aria-pressed', String(draft.favorite))
  renderTags()
}

function renderTags() {
  const box = $('tagbox')
  box.querySelectorAll('.chip').forEach((c) => c.remove())
  const input = $('tag-input')
  for (const tag of draft.tags) {
    const chip = document.createElement('span')
    chip.className = 'chip'
    chip.textContent = tag
    const x = document.createElement('button')
    x.type = 'button'
    x.tabIndex = -1
    x.textContent = '×'
    x.setAttribute('aria-label', `Remove ${tag}`)
    x.addEventListener('click', () => {
      draft.tags = draft.tags.filter((t) => t !== tag)
      renderTags()
      push()
      input.focus()
    })
    chip.append(x)
    box.insertBefore(chip, input)
  }
  input.placeholder = draft.tags.length ? '' : 'Add tags…'
}

function fillDatalists(meta) {
  const tunings = $('tunings')
  tunings.replaceChildren()
  const seen = new Set()
  for (const p of meta.presets ?? PRESET_TUNINGS) {
    seen.add(p.name)
    tunings.append(new Option(p.notes, p.name))
  }
  for (const t of meta.tuningsInUse ?? []) if (!seen.has(t)) tunings.append(new Option('custom', t))
  const tags = $('tag-list')
  tags.replaceChildren(...(meta.tags ?? []).map((t) => new Option('', t)))
}

function addTags(raw) {
  const add = raw
    .split(',')
    .map((t) => t.replace(/^#/, '').trim())
    .filter((t) => t && !draft.tags.some((x) => x.toLowerCase() === t.toLowerCase()))
  if (add.length) {
    draft.tags.push(...add)
    renderTags()
    push()
  }
  $('tag-input').value = ''
}

// ---------- events ----------

for (const f of fields) {
  $(f).addEventListener('input', (e) => {
    touched.add(f)
    draft[f] = e.target.value
    push()
  })
}

$('favorite').addEventListener('click', () => {
  draft.favorite = !draft.favorite
  $('favorite').setAttribute('aria-pressed', String(draft.favorite))
  push()
})

const tagInput = $('tag-input')
tagInput.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ',' || e.key === 'Tab') && tagInput.value.trim()) {
    e.preventDefault()
    e.stopPropagation()
    addTags(tagInput.value)
  } else if (e.key === 'Backspace' && !tagInput.value && draft.tags.length) {
    draft.tags.pop()
    renderTags()
    push()
  }
})
tagInput.addEventListener('input', (e) => {
  // Picking from the datalist inserts the whole value at once.
  if (!e.inputType || e.inputType === 'insertReplacementText') addTags(tagInput.value)
})
tagInput.addEventListener('blur', () => tagInput.value.trim() && addTags(tagInput.value))
$('tagbox').addEventListener('mousedown', (e) => {
  if (e.target === e.currentTarget) {
    e.preventDefault()
    tagInput.focus()
  }
})

$('discard').addEventListener('click', discard)

// Enter anywhere (outside a pending tag) saves and closes.
$('form').addEventListener('submit', (e) => {
  e.preventDefault()
  finish()
})
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.defaultPrevented && !(e.target instanceof HTMLButtonElement)) {
    e.preventDefault()
    finish()
  }
})

// ---------- startup ----------

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.url || !/^https?:\/\//i.test(tab.url)) {
    document.body.classList.add('unsupported')
    setStatus('Riff can only save tabs from web pages.', 'warn')
    $('discard').textContent = 'Close'
    return
  }

  connect()
  draft.tabId = tab.id
  draft.url = tab.url
  Object.assign(draft, pickNonEmpty(guessFromTitle(tab.title, tab.url)))
  renderFields()
  push() // closing immediately still saves something sensible
  $('title').focus()
  $('title').select()

  const cached = (await chrome.storage.local.get('meta').catch(() => ({}))).meta
  fillDatalists(cached ?? { presets: PRESET_TUNINGS })

  const [extracted, lookup, meta] = await Promise.allSettled([
    chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractTabInfo }).then((r) => r?.[0]?.result),
    api(`/lookup?url=${encodeURIComponent(tab.url)}`),
    api('/meta'),
  ])

  if (extracted.status === 'fulfilled' && extracted.value) Object.assign(draft, pickNonEmpty(extracted.value))

  if (meta.status === 'fulfilled') {
    fillDatalists(meta.value)
    chrome.storage.local.set({ meta: meta.value }).catch(() => {})
  }

  if (lookup.status === 'fulfilled') {
    existing = lookup.value.tab
    if (existing) {
      // The saved entry is the source of truth; keep page data only for blanks.
      for (const f of fields) if (existing[f] && !touched.has(f)) draft[f] = existing[f]
      draft.tags = [...new Set([...existing.tags, ...draft.tags])]
      draft.favorite = existing.favorite
      setStatus('✓ Already in your Riff library — edits save when you close this.', 'ok')
      $('discard').textContent = 'Undo Changes'
    } else {
      setStatus('Saves to Riff when you close this.')
    }
  } else {
    setStatus('Riff isn’t running — closing this will open Riff to save.', 'warn')
  }

  renderFields()
  push()
}

function pickNonEmpty(obj) {
  return Object.fromEntries(Object.entries(obj ?? {}).filter(([k, v]) => fields.includes(k) && typeof v === 'string' && v.trim() && !touched.has(k)))
}

init().catch((e) => {
  console.error(e)
  setStatus('Something went wrong reading this page — you can still fill it in.', 'warn')
})
