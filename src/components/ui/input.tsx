import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export const inputClass =
  'h-7 w-full min-w-0 rounded-md border border-border-strong bg-bg-elevated px-2 text-[13px] text-fg shadow-xs outline-none placeholder:text-fg-faint focus:border-accent focus:ring-[3px] focus:ring-ring transition-[box-shadow,border-color]'

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input autoComplete="off" autoCorrect="off" spellCheck={false} className={cn(inputClass, className)} {...props} />
}

export function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn('inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-border bg-bg-subtle px-1 font-sans text-[11px] font-medium text-fg-muted', className)}
      {...props}
    />
  )
}
