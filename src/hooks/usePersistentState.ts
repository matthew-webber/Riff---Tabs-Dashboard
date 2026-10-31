import { useEffect, useState } from 'react'

/** useState backed by localStorage (UI preferences only — the library lives in SQLite). */
export function usePersistentState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw == null ? initial : (JSON.parse(raw) as T)
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* storage unavailable — preferences just won't persist */
    }
  }, [key, value])
  return [value, setValue] as const
}
