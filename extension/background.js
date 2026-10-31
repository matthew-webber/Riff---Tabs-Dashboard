// Background worker: performs the save when the popup closes.
//
// The popup keeps a port open and streams its current draft here. A popup
// can't reliably run async work while it's being closed, but the background
// is notified when the port disconnects — that's our "save on close".

import { api, riffLink } from './riff-api.js'

const sessions = new Map() // port → { draft, discarded, skip }

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'riff-popup') return
  const session = { draft: null, discarded: false, skip: false }
  sessions.set(port, session)

  port.onMessage.addListener((msg) => {
    if (msg.type === 'draft') {
      session.draft = msg.draft
      session.skip = !!msg.unchanged
    } else if (msg.type === 'discard') {
      session.discarded = true
    }
  })

  port.onDisconnect.addListener(() => {
    sessions.delete(port)
    if (session.discarded || session.skip || !session.draft?.url) return
    save(session.draft)
  })
})

async function save(draft) {
  const { tabId, ...body } = draft
  try {
    await api('/tabs', { method: 'POST', body, timeout: 4000 })
    flashBadge(tabId, '✓', '#2f9e44')
  } catch (err) {
    if (err.status) {
      // The app answered but rejected the save (e.g. invalid URL).
      console.warn('Riff rejected the save:', err.message)
      flashBadge(tabId, '!', '#d93a32')
      return
    }
    // Riff isn't running (or is unreachable): hand off via the URI scheme.
    // Navigating to an external protocol doesn't leave the current page.
    try {
      await chrome.tabs.update(tabId, { url: riffLink(draft) })
      flashBadge(tabId, '↗', '#e2602a')
    } catch (e) {
      console.warn('Could not open riff:// link', e)
      flashBadge(tabId, '!', '#d93a32')
    }
  }
}

function flashBadge(tabId, text, color) {
  if (tabId == null) return
  chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {})
  chrome.action.setBadgeText({ tabId, text }).catch(() => {})
  setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {}), 2500)
}
