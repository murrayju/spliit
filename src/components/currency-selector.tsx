import { ChevronDown, Loader2 } from 'lucide-react'

import { Button, ButtonProps } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { MobileCommandDialog } from '@/components/mobile-command-dialog'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Currency } from '@/lib/currency'
import { useMediaQuery } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'
import { forwardRef, useEffect, useState } from 'react'

type Props = {
  currencies: Currency[]
  onValueChange: (currencyCode: Currency['code']) => void
  /** Currency code to be selected by default. Overwriting this value will update current selection, too. */
  defaultValue: Currency['code']
  isLoading: boolean
  compact?: boolean
  triggerClassName?: string
}

export function CurrencySelector({
  currencies,
  onValueChange,
  defaultValue,
  isLoading,
  compact = false,
  triggerClassName,
}: Props) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState<string>(defaultValue)
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const t = useTranslations('Currencies')

  // allow overwriting currently selected currency from outside
  useEffect(() => {
    setValue(defaultValue)
    onValueChange(defaultValue)
  }, [defaultValue])

  const selectedCurrency =
    currencies.find((currency) => (currency.code ?? '') === value) ??
    currencies[0]
  const updateOpen = (nextOpen: boolean) => {
    if (!nextOpen && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    setOpen(nextOpen)
  }
  const selectCurrency = (code: Currency['code']) => {
    setValue(code)
    onValueChange(code)
    updateOpen(false)
  }

  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <CurrencyButton
            currency={selectedCurrency}
            open={open}
            isLoading={isLoading}
            compact={compact}
            className={triggerClassName}
          />
        </PopoverTrigger>
        <PopoverContent className="p-0" align="start">
          <CurrencyCommand
            currencies={currencies}
            onValueChange={selectCurrency}
          />
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <MobileCommandDialog
      open={open}
      onOpenChange={updateOpen}
      title={t('search')}
      trigger={
        <CurrencyButton
          currency={selectedCurrency}
          open={open}
          isLoading={isLoading}
          compact={compact}
          className={triggerClassName}
        />
      }
    >
      <CurrencyCommand
        currencies={currencies}
        onValueChange={selectCurrency}
        mobile
      />
    </MobileCommandDialog>
  )
}

function CurrencyCommand({
  currencies,
  onValueChange,
  mobile = false,
}: {
  currencies: Currency[]
  onValueChange: (currencyId: Currency['code']) => void
  mobile?: boolean
}) {
  const currencyGroup = (currency: Currency) => {
    switch (currency.code) {
      case 'USD':
      case 'EUR':
      case 'JPY':
      case 'GBP':
      case 'CNY':
        return 'common'
      default:
        if (currency.code === '') return 'custom'
        return 'other'
    }
  }
  const t = useTranslations('Currencies')
  const currenciesByGroup = currencies.reduce<Record<string, Currency[]>>(
    (acc, currency) => ({
      ...acc,
      [currencyGroup(currency)]: (acc[currencyGroup(currency)] ?? []).concat([
        currency,
      ]),
    }),
    {},
  )

  return (
    <Command className={mobile ? 'min-h-0 rounded-none' : undefined}>
      <CommandInput placeholder={t('search')} className="pr-12 text-base" />
      <CommandList
        className={
          mobile
            ? 'max-h-none min-h-0 flex-1 overscroll-contain pb-[env(safe-area-inset-bottom)]'
            : undefined
        }
      >
        <CommandEmpty>{t('noCurrency')}</CommandEmpty>
        {Object.entries(currenciesByGroup).map(
          ([group, groupCurrencies], index) => (
            <CommandGroup key={index} heading={t(`${group}.heading`)}>
              {groupCurrencies.map((currency) => (
                <CommandItem
                  key={currency.code}
                  className={
                    mobile
                      ? 'min-h-11 rounded-none px-3 py-2.5 text-base'
                      : undefined
                  }
                  value={`${currency.code} ${currency.name} ${currency.symbol}`}
                  onSelect={() => onValueChange(currency.code)}
                >
                  <CurrencyLabel currency={currency} />
                </CommandItem>
              ))}
            </CommandGroup>
          ),
        )}
      </CommandList>
    </Command>
  )
}

type CurrencyButtonProps = {
  currency: Currency
  open: boolean
  isLoading: boolean
  compact: boolean
}
const CurrencyButton = forwardRef<
  HTMLButtonElement,
  CurrencyButtonProps & ButtonProps
>(
  (
    {
      currency,
      open,
      isLoading,
      compact,
      className,
      ...props
    }: ButtonProps & CurrencyButtonProps,
    ref,
  ) => {
    const iconClassName = compact
      ? 'h-3.5 w-3.5 shrink-0 opacity-50'
      : 'ml-2 h-4 w-4 shrink-0 opacity-50'
    return (
      <Button
        variant="outline"
        role="combobox"
        aria-expanded={open}
        className={cn(
          'flex w-full justify-between',
          compact && 'w-auto gap-1 px-3 font-semibold',
          className,
        )}
        ref={ref}
        {...props}
      >
        {compact ? (
          <span>{currency.code}</span>
        ) : (
          <CurrencyLabel currency={currency} />
        )}
        {isLoading ? (
          <Loader2 className={`animate-spin ${iconClassName}`} />
        ) : (
          <ChevronDown className={iconClassName} />
        )}
      </Button>
    )
  },
)
CurrencyButton.displayName = 'CurrencyButton'

function CurrencyLabel({ currency }: { currency: Currency }) {
  const flagUrl = `https://flagcdn.com/h24/${
    currency?.code.length ? currency.code.slice(0, 2).toLowerCase() : 'un'
  }.png`
  return (
    <div className="flex items-center gap-3">
      <img src={flagUrl} className="w-4" alt="" />
      {currency.name}
      {currency.code ? ` (${currency.code})` : ''}
    </div>
  )
}
