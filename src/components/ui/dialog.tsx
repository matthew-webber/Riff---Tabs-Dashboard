import { Dialog as D } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export const Dialog = D.Root
export const DialogTitle = D.Title
export const DialogDescription = D.Description
export const DialogClose = D.Close

export function DialogContent({ className, children, ...props }: ComponentProps<typeof D.Content>) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-black/20 dark:bg-black/40" />
      <D.Content
        className={cn(
          'fixed left-1/2 top-[14%] z-50 w-[min(460px,calc(100vw-32px))] -translate-x-1/2 rounded-xl border border-border bg-bg-elevated p-5 shadow-pop animate-pop-in outline-none',
          className,
        )}
        {...props}
      >
        {children}
      </D.Content>
    </D.Portal>
  )
}
