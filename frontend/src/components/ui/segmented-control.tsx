import * as React from 'react'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { spring } from '@/lib/motion'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export interface SegmentOption<T extends string> {
  value: T
  label: string
  icon?: React.ReactNode
}

export interface SegmentedControlProps<T extends string> {
  value: T
  onValueChange: (value: T) => void
  options: SegmentOption<T>[]
  disabled?: boolean
  'aria-label'?: string
  className?: string
}

export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  disabled = false,
  'aria-label': ariaLabel,
  className,
}: SegmentedControlProps<T>) {
  const groupRef = React.useRef<HTMLDivElement>(null)

  function handleKeyDown(e: React.KeyboardEvent, index: number) {
    if (disabled) return
    let next = index
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      next = (index + 1) % options.length
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      next = (index - 1 + options.length) % options.length
    } else {
      return
    }
    onValueChange(options[next].value)
    const buttons = groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    buttons?.[next]?.focus()
  }

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'relative inline-flex items-center rounded-md bg-fill p-0.5',
        disabled && 'opacity-40 pointer-events-none',
        className,
      )}
    >
      {options.map((option, index) => {
        const isSelected = option.value === value
        const button = (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={option.icon ? option.label : undefined}
            tabIndex={isSelected ? 0 : -1}
            disabled={disabled}
            onClick={() => onValueChange(option.value)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className={cn(
              'relative z-10 inline-flex h-6 items-center justify-center gap-1 rounded-[5px] px-2 text-callout font-medium transition-colors duration-100',
              isSelected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {isSelected && (
              <motion.span
                layoutId="segmented-highlight"
                className="absolute inset-0 rounded-[5px] bg-elevated shadow-[0_1px_2px_hsl(0_0%_0%/.12),0_0_0_0.5px_hsl(0_0%_0%/.06)]"
                transition={spring.snappy}
                style={{ zIndex: -1 }}
              />
            )}
            {option.icon && <span className="[&_svg]:h-3.5 [&_svg]:w-3.5">{option.icon}</span>}
            {option.icon ? null : <span>{option.label}</span>}
          </button>
        )

        // Icon-only segments get a tooltip
        if (option.icon) {
          return (
            <Tooltip key={option.value} delayDuration={500}>
              <TooltipTrigger asChild>{button}</TooltipTrigger>
              <TooltipContent>{option.label}</TooltipContent>
            </Tooltip>
          )
        }

        return button
      })}
    </div>
  )
}
