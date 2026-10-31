import { Info, Star } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, errorMessage, type Tab, type TuningPreset } from '@/lib/api'
import { cn, guessFromUrl } from '@/lib/utils'
import { TagInput } from './TagInput'
import { TuningInput } from './TuningInput'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial: { url?: string; tuning?: string; tags?: string[]; favorite?: boolean }
  presets: TuningPreset[]
  tuningsInUse: string[]
  allTags: string[]
  onSaved: (tab: Tab, created: boolean) => void
  onShowExisting: (tab: Tab) => void
}

export function AddTabDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent aria-describedby={undefined}>{props.open && <AddTabForm {...props} />}</DialogContent>
    </Dialog>
  )
}

function AddTabForm({ initial, presets, tuningsInUse, allTags, onSaved, onShowExisting, onOpenChange }: Props) {
  const [url, setUrl] = useState(initial.url ?? '')
  const [title, setTitle] = useState(() => guessFromUrl(initial.url ?? '').title ?? '')
  const [artist, setArtist] = useState(() => guessFromUrl(initial.url ?? '').artist ?? '')
  const [touched, setTouched] = useState(false)
  const [tuning, setTuning] = useState(initial.tuning ?? '')
  const [tags, setTags] = useState<string[]>(initial.tags ?? [])
  const [favorite, setFavorite] = useState(initial.favorite ?? false)
  const [existing, setExisting] = useState<Tab | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const changeUrl = (u: string) => {
    setUrl(u)
    if (!touched) {
      const g = guessFromUrl(u.trim())
      setTitle(g.title ?? '')
      setArtist(g.artist ?? '')
    }
  }

  // Look for an existing entry with this URL as it's typed.
  useEffect(() => {
    const u = url.trim()
    let live = true
    const t = setTimeout(() => {
      if (!u) return setExisting(null)
      api.lookupUrl(u).then(
        (tab) => live && setExisting(tab),
        () => live && setExisting(null),
      )
    }, 150)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [url])

  const submit = async () => {
    if (!url.trim()) return setError('Paste the link to the tab first.')
    setSaving(true)
    setError(null)
    try {
      const res = await api.saveTab({
        url: url.trim(),
        // Don't wipe an existing entry's details with blanks.
        title: title.trim() || existing?.title || '',
        artist: artist.trim() || existing?.artist || '',
        tuning: tuning.trim() || existing?.tuning || '',
        tags: [...new Set([...(existing?.tags ?? []), ...tags])],
        favorite: favorite || existing?.favorite,
      })
      onSaved(res.tab, res.created)
      onOpenChange(false)
    } catch (e) {
      setError(errorMessage(e))
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          submit()
        }
      }}
    >
      <DialogTitle className="text-[15px] font-semibold">Add Tab</DialogTitle>
      <DialogDescription className="mt-0.5 text-xs text-fg-muted">
        Tip: the Riff browser extension does this in one click.
      </DialogDescription>

      <div className="mt-4 grid grid-cols-[72px_1fr] items-center gap-x-3 gap-y-2.5">
        <label htmlFor="add-url" className="text-right text-xs text-fg-muted">
          Link
        </label>
        <Input id="add-url" autoFocus={!initial.url} value={url} onChange={(e) => changeUrl(e.target.value)} placeholder="https://tabs.ultimate-guitar.com/…" />

        {existing && (
          <div className="col-start-2 -mt-1 flex items-center gap-1.5 text-xs text-fg-muted">
            <Info className="size-3.5 shrink-0 text-accent" />
            <span className="min-w-0 truncate">
              Already saved as “{existing.title || 'Untitled'}”. Saving will update it.
            </span>
            <Button
              variant="link"
              className="text-xs"
              onClick={() => {
                onShowExisting(existing)
                onOpenChange(false)
              }}
            >
              Show
            </Button>
          </div>
        )}

        <label htmlFor="add-title" className="text-right text-xs text-fg-muted">
          Title
        </label>
        <Input
          id="add-title"
          autoFocus={!!initial.url}
          value={title}
          placeholder={existing?.title || 'Song title'}
          onChange={(e) => {
            setTouched(true)
            setTitle(e.target.value)
          }}
        />

        <label htmlFor="add-artist" className="text-right text-xs text-fg-muted">
          Artist
        </label>
        <Input
          id="add-artist"
          value={artist}
          placeholder={existing?.artist || 'Artist'}
          onChange={(e) => {
            setTouched(true)
            setArtist(e.target.value)
          }}
        />

        <label htmlFor="add-tuning" className="text-right text-xs text-fg-muted">
          Tuning
        </label>
        <TuningInput id="add-tuning" value={tuning} onChange={setTuning} presets={presets} inUse={tuningsInUse} />

        <label htmlFor="add-tags" className="text-right text-xs text-fg-muted">
          Tags
        </label>
        <TagInput id="add-tags" value={tags} onChange={setTags} suggestions={allTags} />

        <span />
        <label className="flex w-fit items-center gap-1.5 rounded px-0.5 text-[13px] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
          <input type="checkbox" className="sr-only" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} />
          <Star className={cn('size-4', favorite ? 'text-star' : 'text-fg-faint')} fill={favorite ? 'currentColor' : 'none'} />
          Favorite
        </label>
      </div>

      {error && <p className="mt-3 text-xs text-danger">{error}</p>}

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {existing ? 'Update Tab' : 'Add Tab'}
        </Button>
      </div>
    </form>
  )
}
