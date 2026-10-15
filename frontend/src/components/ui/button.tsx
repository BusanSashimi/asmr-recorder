import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-body font-medium select-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 motion-safe:active:scale-[0.97] transition-[transform,background-color,color] duration-100 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        default:
          'bg-elevated border border-input shadow-[0_1px_1px_hsl(0_0%_0%/.06)] hover:bg-fill-hover/40',
        accent:
          'bg-accent text-accent-foreground hover:bg-accent/90',
        record:
          'bg-record text-record-foreground hover:bg-record/90 rounded-full',
        destructive:
          'text-destructive hover:bg-destructive/10',
        outline:
          'bg-elevated border border-input shadow-[0_1px_1px_hsl(0_0%_0%/.06)] hover:bg-fill-hover/40',
        secondary:
          'bg-fill hover:bg-fill-hover',
        ghost:
          'hover:bg-fill',
        link:
          'text-accent underline-offset-4 hover:underline',
        hud:
          'mat-hud hover:bg-[hsl(var(--hud)/0.7)]',
      },
      size: {
        default: 'h-7 px-3',
        sm:      'h-7 px-2.5',
        lg:      'h-8 px-4',
        icon:    'h-7 w-7',
        'icon-sm': 'h-[22px] w-[22px]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
