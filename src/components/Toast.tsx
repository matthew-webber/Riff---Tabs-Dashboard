import { useEffect } from 'react'
import { cn } from '@/lib/utils'

export interface ToastData {
  id: number
  message: string
  action?: { label: string; run: () => void }
  tone?: 'default' | 'error'
}

export function Toast({ toast, onDismiss }: { toast: ToastData | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(onDismiss, toast.action ? 6000 : 3500)
    return () => clearTimeout(t)
  }, [toast, onDismiss])

  if (!toast) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4" role="status" aria-live="polite">
      <div
        key={toast.id}
        className={cn(
          'pointer-events-auto flex max-w-md items-center gap-3 rounded-lg border border-border bg-bg-elevated/95 py-2 pl-3.5 pr-2 text-[13px] shadow-pop backdrop-blur-xl animate-toast-in',
          toast.tone === 'error' && 'text-danger',
          !toast.action && 'pr-3.5',
        )}
      >
        <span className="min-w-0 truncate">{toast.message}</span>
        {toast.action && (
          <button
            className="shrink-0 rounded-md px-2 py-0.5 font-medium text-accent hover:bg-accent-soft"
            onClick={() => {
              toast.action!.run()
              onDismiss()
            }}
          >
            {toast.action.label}
          </button>
        )}
      </div>
    </div>
  )
}
