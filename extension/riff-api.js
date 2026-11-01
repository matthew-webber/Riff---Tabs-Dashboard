// Talking to the Riff desktop app.
//
// Preferred: the app's loopback API (silent, two-way). Fallback when the app
// isn't running: a riff:// link, which macOS routes to (and launches) Riff.

export const API = 'http://127.0.0.1:47813/api'

// Mirrors PRESETS in src-tauri/src/tuning.rs; used until Riff sends its own list.
export const PRESET_TUNINGS = [
  ['Standard', 'E A D G B E'],
  ['Drop D', 'D A D G B E'],
  ['Eb Standard', 'Eb Ab Db Gb Bb Eb'],
  ['D Standard', 'D G C F A D'],
  ['Drop C#', 'C# G# C# F# A# D#'],
  ['Drop C', 'C G C F A D'],
  ['C# Standard', 'C# F# B E G# C#'],
  ['C Standard', 'C F Bb Eb G C'],
  ['Drop B', 'B F# B E G# C#'],
  ['B Standard', 'B E A D F# B'],
  ['Drop A', 'A E A D F# B'],
  ['Open G', 'D G D G B D'],
  ['Open D', 'D A D F# A D'],
  ['Open E', 'E B E G# B E'],
  ['Open C', 'C G C G C E'],
  ['DADGAD', 'D A D G A D'],
  ['7-String Standard', 'B E A D G B E'],
  ['Bass Standard', 'E A D G'],
  ['5-String Bass', 'B E A D G', false],
  ['7-String Drop A', 'A E A D G B E', false],
  ['A Standard', 'A D G C E A', false],
  ['Bass Drop D', 'D A D G', false],
  ['Bb Standard', 'Bb Eb Ab Db F Bb', false],
  ['Double Drop D', 'D A D G B D', false],
  ['Drop Bb', 'Bb F Bb Eb G C', false],
  ['Drop G', 'G D G C E A', false],
  ['Open A', 'E A E A C# E', false],
  ['Open D Minor', 'D A D F A D', false],
  ['Open G Minor', 'D G D G Bb D', false],
].map(([name, notes, common = true]) => ({ name, notes, common }))

export async function api(path, { method = 'GET', body, timeout = 1500 } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(API + path, {
      method,
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'X-Riff-Client': 'extension' },
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status })
    return data
  } finally {
    clearTimeout(timer)
  }
}

/** Build a riff://add link for when the app isn't reachable over HTTP. */
export function riffLink(draft) {
  const q = new URLSearchParams({ url: draft.url })
  if (draft.title) q.set('title', draft.title)
  if (draft.artist) q.set('artist', draft.artist)
  if (draft.tuning) q.set('tuning', draft.tuning)
  if (draft.tags?.length) q.set('tags', draft.tags.join(','))
  if (draft.favorite) q.set('favorite', '1')
  return `riff://add?${q}`
}
