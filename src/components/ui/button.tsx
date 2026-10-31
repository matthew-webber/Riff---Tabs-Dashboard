import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 focus-visible:ring-[3px] focus-visible:ring-ring [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-accent text-accent-fg hover:bg-accent-hover shadow-sm',
        secondary: 'bg-bg-elevated text-fg border border-border-strong shadow-xs hover:bg-bg-hover',
        ghost: 'text-fg-muted hover:bg-bg-hover hover:text-fg',
        danger: 'bg-danger text-white hover:opacity-90',
        link: 'text-accent hover:underline px-0 h-auto',
      },
      size: {
        default: 'h-7 px-3',
        sm: 'h-6 px-2 text-xs',
        icon: 'size-7',
        'icon-sm': 'size-6 [&_svg]:size-3.5',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export function Button({ className, variant, size, type = 'button', ...props }: ComponentProps<'button'> & VariantProps<typeof buttonVariants>) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
}
