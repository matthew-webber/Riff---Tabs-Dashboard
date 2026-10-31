import { ContextMenu as CM } from 'radix-ui'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export const ContextMenu = CM.Root
export const ContextMenuTrigger = CM.Trigger

export const menuContentClass =
  'z-50 min-w-[190px] overflow-hidden rounded-lg border border-border bg-bg-elevated/95 p-1 text-fg shadow-pop backdrop-blur-xl animate-pop-in'

export function ContextMenuContent({ className, ...props }: ComponentProps<typeof CM.Content>) {
  return (
    <CM.Portal>
      <CM.Content className={cn(menuContentClass, className)} {...props} />
    </CM.Portal>
  )
}

export const menuItemClass =
  'relative flex h-6 select-none items-center gap-2 rounded-[5px] px-2 text-[13px] outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-fg data-[disabled]:opacity-40 [&_svg]:size-3.5'

export function ContextMenuItem({ className, shortcut, destructive, children, ...props }: ComponentProps<typeof CM.Item> & { shortcut?: ReactNode; destructive?: boolean }) {
  return (
    <CM.Item className={cn(menuItemClass, destructive && 'text-danger data-[highlighted]:bg-danger', className)} {...props}>
      {children}
      {shortcut && <span className="ml-auto pl-4 text-xs opacity-60">{shortcut}</span>}
    </CM.Item>
  )
}

export function ContextMenuSeparator() {
  return <CM.Separator className="mx-1 my-1 h-px bg-border" />
}
