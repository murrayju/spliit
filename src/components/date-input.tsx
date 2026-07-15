'use client'

import { Locale } from '@/i18n/request'
import { CalendarDays } from 'lucide-react'
import { useLocale } from 'next-intl'
import { FormControl } from './ui/form'
import { Input } from './ui/input'

export function DateInput({
  value,
  onChange,
  label,
}: {
  value?: Date
  onChange: (value: Date) => void
  label: string
}) {
  const locale = useLocale() as Locale
  const inputValue = formatDateInputValue(value)
  const displayValue = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(`${inputValue}T00:00:00Z`))

  return (
    <div className="relative h-10 w-full overflow-hidden rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
      <div
        aria-hidden="true"
        className="pointer-events-none flex h-full items-center justify-between px-3 text-sm"
      >
        <span>{displayValue}</span>
        <CalendarDays className="h-4 w-4 text-muted-foreground" />
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
