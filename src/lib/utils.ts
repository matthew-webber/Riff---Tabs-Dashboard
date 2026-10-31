import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)

/** Fold case and diacritics so "Beyoncé" matches "beyonce". */
export function fold(s: string) {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const dateFmtYear = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
const fullFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function relativeDate(ms: number | null | undefined): string {
  if (!ms) return '—'
  const diff = Date.now() - ms
  const min = 60_000
  const hour = 60 * min
  const day = 24 * hour
  if (diff < min) return 'Just now'
  if (diff < hour) return rtf.format(-Math.round(diff / min), 'minute')
  if (diff < day) return rtf.format(-Math.round(diff / hour), 'hour')
  if (diff < 7 * day) {
    const days = Math.round(diff / day)
    return days === 1 ? 'Yesterday' : rtf.format(-days, 'day')
  }
  const d = new Date(ms)
  return d.getFullYear() === new Date().getFullYear() ? dateFmt.format(d) : dateFmtYear.format(d)
}

export function fullDate(ms: number | null | undefined): string {
  return ms ? fullFmt.format(new Date(ms)) : 'Never'
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Best-effort title/artist from well-known tab URL shapes. */
export function guessFromUrl(raw: string): { title?: string; artist?: string } {
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return {}
  }
  const titleCase = (slug: string) =>
    decodeURIComponent(slug)
      .split('-')
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
  // tabs.ultimate-guitar.com/tab/<artist>/<song>-<type>-<id>
  const ug = url.hostname.endsWith('ultimate-guitar.com') && url.pathname.match(/^\/tab\/([^/]+)\/([^/]+?)(?:-(?:chords|tabs?|bass|ukulele|guitar-pro|power|drums|video|official))*(?:-\d+)?\/?$/i)
  if (ug) return { artist: titleCase(ug[1]), title: titleCase(ug[2]) }
  return {}
}
