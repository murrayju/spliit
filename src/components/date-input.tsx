'use client'

import { Locale } from '@/i18n/request'
import { cn } from '@/lib/utils'
import { CalendarDays } from 'lucide-react'
import { useLocale } from 'next-intl'
import { FormControl } from './ui/form'
import { Input } from './ui/input'

export function DateInput({
  value,
  onChange,
  label,
  variant = 'default',
}: {
  value?: Date
  onChange: (value: Date) => void
  label: string
  variant?: 'default' | 'summary'
}) {
  const locale = useLocale() as Locale
  const inputValue = formatDateInputValue(value)
  const displayValue = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(`${inputValue}T00:00:00Z`))

  return (
    <div
      className={cn(
        'relative w-full overflow-hidden border border-input bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
        variant === 'summary' ? 'min-h-16 rounded-md' : 'h-10 rounded-md',
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none flex h-full items-center text-sm',
          variant === 'summary'
            ? 'min-h-16 justify-start gap-3 px-4 py-3 text-left'
            : 'justify-between px-3',
        )}
      >
        {variant === 'summary' ? (
          <>
            <CalendarDays className="h-5 w-5 shrink-0 text-primary" />
            <span className="flex min-w-0 flex-col">
              <span className="text-xs text-muted-foreground">{label}</span>
              <span>{displayValue}</span>
            </span>
          </>
        ) : (
          <>
            <span>{displayValue}</span>
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
          </>
        )}
      </div>
      <FormControl>
        <Input
          aria-label={label}
          className="absolute inset-0 z-10 h-full w-full cursor-pointer border-0 bg-transparent p-0 opacity-0"
          type="date"
          value={inputValue}
          onChange={(event) => onChange(new Date(event.target.value))}
        />
      </FormControl>
    </div>
  )
}

function formatDateInputValue(date?: Date) {
  if (!date || isNaN(date.getTime())) date = new Date()
  return date.toISOString().substring(0, 10)
}
