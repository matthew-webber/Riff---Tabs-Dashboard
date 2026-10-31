// Page metadata extraction. `extractTabInfo` is injected into the current
// page with chrome.scripting.executeScript, so it must be self-contained
// (no imports, no closures over module scope).
//
// Strategy: site-specific extractors first, then generic fallbacks
// (JSON-LD, Open Graph, document title, "Tuning: …" text on the page).
// Everything is best-effort; failures return empty strings.

export function extractTabInfo() {
  const out = { title: '', artist: '', tuning: '' }
  const clean = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '')
  const meta = (sel) => clean(document.querySelector(sel)?.getAttribute('content'))
  const isShouting = (s) => s.length > 3 && s === s.toUpperCase() && /[A-Z]/.test(s)
  const titleCase = (s) => s.toLowerCase().replace(/(^|[\s(\-"'])(\p{L})/gu, (_, p, c) => p + c.toUpperCase())
  const tidyTitle = (s) => {
    s = clean(s)
      .replace(/\s*\((?:ver(?:sion)?\.?\s*\d+|official|acoustic|live)\)\s*/gi, ' ')
      .replace(/\s+(?:guitar\s+pro\s+tab|bass\s+tabs?|drum\s+tabs?|ukulele\s+chords|power\s+tab|chords?\s*(?:&|and)\s*tabs?|tabs?|chords?|solo\s+tab)\s*$/i, '')
      .trim()
    return isShouting(s) ? titleCase(s) : s
  }
  // "Song Chords by Artist @ Site", "Song Tab by Artist | Site", "Song by Artist - Site"
  const fromByPattern = (s) => {
    const m = clean(s).match(/^(.+)\s+by\s+(.+?)(?:\s+(?:@|\||–|—|-)\s+.*)?$/i)
    return m ? { title: tidyTitle(m[1]), artist: clean(m[2]) } : null
  }
  const host = location.hostname.replace(/^www\./, '')

  try {
    if (host.endsWith('ultimate-guitar.com')) {
      // UG embeds its page state as JSON in a data attribute.
      const raw = document.querySelector('.js-store')?.getAttribute('data-content')
      if (raw) {
        const data = JSON.parse(raw)
        const page = data?.store?.page?.data ?? {}
        const tab = page.tab ?? {}
        out.title = clean(tab.song_name)
        out.artist = clean(tab.artist_name)
        const t = page.tab_view?.meta?.tuning
        out.tuning = clean(t?.value || t?.name || (typeof t === 'string' ? t : ''))
      }
      // Current UG pages link the tab's tuning to their tuner tool.
      const tuner = document.querySelector('a[href*="/tools/tuner?tuning="]')
      if (tuner && !out.tuning) out.tuning = clean(new URL(tuner.href).searchParams.get('tuning') || tuner.textContent)
    } else if (host.endsWith('songsterr.com')) {
      // "Enter Sandman Tab by Metallica | Songsterr Tabs with Rhythm"
      const r = fromByPattern(document.title.replace(/\s*\|\s*Songsterr.*$/i, ''))
      if (r) Object.assign(out, r)
      // The tab's open-string notes are drawn in the score, highest string first.
      const first = document.querySelector('[aria-label="Open string note"]')
      const notes = first ? [...first.parentElement.querySelectorAll('[aria-label="Open string note"]')].map((e) => clean(e.textContent)) : []
      if (notes.length >= 4 && notes.every((n) => /^[A-G][#b♭♯]?$/.test(n))) out.tuning = notes.reverse().join(' ')
    }
  } catch {
    /* fall through to generic extraction */
  }

  // JSON-LD (MusicComposition / MusicRecording / CreativeWork).
  if (!out.title || !out.artist) {
    for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const items = [JSON.parse(el.textContent)].flat().flatMap((x) => x?.['@graph'] ?? [x])
        for (const it of items) {
          const type = [it?.['@type']].flat().join(' ')
          if (!/Music|CreativeWork/i.test(type)) continue
          out.title ||= tidyTitle(it.name || '')
          const by = it.byArtist || it.composer || it.author
          out.artist ||= clean([by].flat()[0]?.name || (typeof by === 'string' ? by : ''))
        }
      } catch {
        /* ignore malformed JSON-LD */
      }
    }
  }

  // Titles: "X by Y" patterns, then "Artist - Song" patterns.
  if (!out.title || !out.artist) {
    for (const s of [meta('meta[property="og:title"]'), document.title]) {
      if (!s) continue
      const r = fromByPattern(s)
      if (r) {
        out.title ||= r.title
        out.artist ||= r.artist
        break
      }
      const dash = clean(s).match(/^(.+?)\s+[-–—]\s+(.+?)(?:\s+[-–—|]\s+.*)?$/)
      if (dash && /tab|chord/i.test(s)) {
        out.artist ||= clean(dash[1])
        out.title ||= tidyTitle(dash[2])
        break
      }
    }
  }
  if (!out.title) out.title = tidyTitle((meta('meta[property="og:title"]') || document.title).split(/\s+[|@–—]\s+/)[0])

  // Many sites print "Tuning: E A D G B E" near the top — either in one text
  // node or as a label followed by an element holding the value.
  if (!out.tuning && document.body) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n, i = 0; (n = walker.nextNode()) && i < 8000; i++) {
      const m = clean(n.textContent).match(/^Tuning\s*:?\s*(.{0,40})$/i)
      if (!m) continue
      const el = n.parentElement
      const value = m[1] || clean((el?.nextElementSibling ?? el?.parentElement?.nextElementSibling)?.textContent)
      if (value && value.length <= 40) {
        out.tuning = value
        break
      }
    }
  }

  if (isShouting(out.artist)) out.artist = titleCase(out.artist)
  return out
}

/** Fallback when we can't inject (e.g. restricted pages): parse the tab's title. */
export function guessFromTitle(title, url) {
  const out = { title: '', artist: '', tuning: '' }
  const m = (title || '').match(/^(.+?)\s+(?:chords|tabs?|bass tabs?)?\s*(?:\(ver \d+\))?\s*by\s+(.+?)(?:\s+[@|].*)?$/i)
  if (m) {
    out.title = m[1].trim()
    out.artist = m[2].trim()
  }
  try {
    const u = new URL(url)
    const ug = u.hostname.endsWith('ultimate-guitar.com') && u.pathname.match(/^\/tab\/([^/]+)\/([^/]+?)(?:-(?:chords|tabs?|bass|ukulele|guitar-pro|power|drums|official))*(?:-\d+)?\/?$/i)
    if (ug) {
      const tc = (s) => s.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
      out.artist ||= tc(ug[1])
      out.title ||= tc(ug[2])
    }
  } catch {
    /* not a URL */
  }
  return out
}
