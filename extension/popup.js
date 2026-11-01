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

/** Delete this page's entry from the library, then close without saving. */
async function remove() {
  const btn = $('remove')
  btn.disabled = true
  btn.textContent = 'Removing…'
  // Stop the background from re-saving if the popup closes mid-request.
  port?.postMessage({ type: 'discard' })
  try {
    await api(`/tabs?url=${encodeURIComponent(draft.url)}`, { method: 'DELETE', timeout: 3000 })
    port?.postMessage({ type: 'removed' })
    closing = true
    window.close()
  } catch (e) {
    port?.postMessage({ type: 'resume' })
    btn.disabled = false
    btn.textContent = 'Remove from Riff'
    setStatus(`Couldn’t remove it: ${e.message || 'Riff isn’t responding'}`, 'warn')
  }
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

function fillSuggestions(meta) {
  const presets = meta.presets ?? PRESET_TUNINGS
  tuningOptions = [
    ...presets.map((p) => ({ value: p.name, detail: p.notes, notes: p.notes, group: p.common === false ? 'more' : 'common' })),
    ...(meta.tuningsInUse ?? []).filter((t) => !presets.some((p) => p.name === t)).map((t) => ({ value: t, detail: 'custom', notes: '', group: 'custom' })),
  ]
  if (!$('tuning-menu').hidden) openMenu()
  const tags = $('tag-list')
  tags.replaceChildren(...(meta.tags ?? []).map((t) => new Option('', t)))
}

// ---------- tuning combobox ----------
// Common tunings, a separator, then less common ones A–Z, then custom
// tunings already in the library. Typing filters by name or notes.

let tuningOptions = []
let shown = []
let active = -1
const squash = (s) => s.toLowerCase().replace(/♭/g, 'b').replace(/♯/g, '#').replace(/[\s,\-/|]+/g, '')

function openMenu() {
  const input = $('tuning')
  const menu = $('tuning-menu')
  const q = squash(input.value)
  shown =
    !q || tuningOptions.some((o) => o.value === input.value)
      ? tuningOptions
      : tuningOptions.filter((o) => squash(o.value).includes(q) || (o.notes && squash(o.notes).startsWith(q)))
  if (active >= shown.length) active = shown.length - 1
  menu.replaceChildren()
  shown.forEach((o, i) => {
    if (i > 0 && o.group !== shown[i - 1].group) {
      const sep = document.createElement('div')
      sep.className = 'sep'
      sep.setAttribute('role', 'separator')
      menu.append(sep)
    }
    const el = document.createElement('div')
    el.className = 'option'
    el.id = `tuning-option-${i}`
    el.dataset.index = i
    el.setAttribute('role', 'option')
    const name = document.createElement('span')
    name.textContent = o.value
    const detail = document.createElement('span')
    detail.className = 'detail'
    detail.textContent = o.detail
    el.append(name, detail)
    menu.append(el)
  })
  menu.hidden = shown.length === 0
  input.setAttribute('aria-expanded', String(!menu.hidden))
  highlight(active)
  // The popup sizes itself to the page, so make room for the menu.
  document.body.style.minHeight = menu.hidden ? '' : `${Math.ceil(menu.getBoundingClientRect().bottom + window.scrollY + 8)}px`
}

function closeMenu() {
  $('tuning-menu').hidden = true
  $('tuning').setAttribute('aria-expanded', 'false')
  $('tuning').removeAttribute('aria-activedescendant')
  document.body.style.minHeight = ''
  active = -1
}

function highlight(i) {
  active = i
  const menu = $('tuning-menu')
  for (const el of menu.querySelectorAll('.option')) el.setAttribute('aria-selected', String(Number(el.dataset.index) === i))
  const el = $(`tuning-option-${i}`)
  if (el) {
    el.scrollIntoView({ block: 'nearest' })
    $('tuning').setAttribute('aria-activedescendant', el.id)
  } else {
    $('tuning').removeAttribute('aria-activedescendant')
  }
}

function pickTuning(value) {
  const input = $('tuning')
  input.value = value
  touched.add('tuning')
  draft.tuning = value
  push()
  closeMenu()
}

{
  const input = $('tuning')
  const menu = $('tuning-menu')
  input.addEventListener('focus', openMenu)
  input.addEventListener('click', () => menu.hidden && openMenu())
  input.addEventListener('blur', closeMenu)
  input.addEventListener('input', () => {
    active = input.value.trim() ? 0 : -1
    openMenu()
  })
  input.addEventListener('keydown', (e) => {
    const open = !menu.hidden
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) return openMenu()
      const d = e.key === 'ArrowDown' ? 1 : -1
      highlight(Math.max(-1, Math.min(shown.length - 1, active + d)))
    } else if (e.key === 'Enter' && open && shown[active]) {
      e.preventDefault()
      e.stopPropagation()
      pickTuning(shown[active].value)
    } else if (e.key === 'Escape' && open) {
      e.preventDefault()
      e.stopPropagation()
      closeMenu()
    }
  })
  menu.addEventListener('mousedown', (e) => e.preventDefault()) // keep focus in the input
  menu.addEventListener('mousemove', (e) => {
    const el = e.target.closest('.option')
    if (el && Number(el.dataset.index) !== active) highlight(Number(el.dataset.index))
  })
  menu.addEventListener('click', (e) => {
    const el = e.target.closest('.option')
    if (el) pickTuning(shown[Number(el.dataset.index)].value)
  })
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
$('remove').addEventListener('click', remove)

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
  fillSuggestions(cached ?? { presets: PRESET_TUNINGS })

  const [extracted, lookup, meta] = await Promise.allSettled([
    extract(tab.id),
    api(`/lookup?url=${encodeURIComponent(tab.url)}`),
    api('/meta'),
  ])

  if (extracted.status === 'fulfilled' && extracted.value) Object.assign(draft, pickNonEmpty(extracted.value))

  if (meta.status === 'fulfilled') {
    fillSuggestions(meta.value)
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
      $('hint').hidden = true
      $('remove').hidden = false
    } else {
      // Most tabs are in standard tuning; sites often only mention it otherwise.
      if (!draft.tuning && !touched.has('tuning')) draft.tuning = 'Standard'
      setStatus('Saves to Riff when you close this.')
    }
  } else {
    setStatus('Riff isn’t running — closing this will open Riff to save.', 'warn')
  }

  renderFields()
  push()
}

/** Read title/artist/tuning from the page, with the tuning in Riff's own terms ("EADGBe" → "Standard"). */
async function extract(tabId) {
  const info = (await chrome.scripting.executeScript({ target: { tabId }, func: extractTabInfo }))?.[0]?.result
  if (info?.tuning) {
    const normalized = await api(`/normalize?tuning=${encodeURIComponent(info.tuning)}`).catch(() => null)
    // If Riff isn't running, keep the page's wording; Riff normalizes it on save.
    if (normalized?.tuning) info.tuning = normalized.tuning
  }
  return info
}

function pickNonEmpty(obj) {
  return Object.fromEntries(Object.entries(obj ?? {}).filter(([k, v]) => fields.includes(k) && typeof v === 'string' && v.trim() && !touched.has(k)))
}

init().catch((e) => {
  console.error(e)
  setStatus('Something went wrong reading this page — you can still fill it in.', 'warn')
})
