import { CategorySelector } from '@/components/category-selector'
import { CurrencySelector } from '@/components/currency-selector'
import { DateInput } from '@/components/date-input'
import { ExpenseDocumentsInput } from '@/components/expense-documents-input'
import { SubmitButton } from '@/components/submit-button'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Locale } from '@/i18n/request'
import { randomId } from '@/lib/api'
import { defaultCurrencyList, getCurrency } from '@/lib/currency'
import {
  ExpenseEntryType,
  amountForEntryForm,
  amountForEntryStorage,
  inferExpenseEntryType,
} from '@/lib/expense-entry'
import { RuntimeFeatureFlags } from '@/lib/featureFlags'
import { useActiveUser, useCurrencyRate } from '@/lib/hooks'
import {
  ExpenseFormValues,
  SplittingOptions,
  expenseFormSchema,
} from '@/lib/schemas'
import { calculateShare } from '@/lib/totals'
import {
  amountAsDecimal,
  amountAsMinorUnits,
  cn,
  formatCurrency,
  getCurrencyFromGroup,
} from '@/lib/utils'
import { AppRouterOutput } from '@/trpc/routers/_app'
import { zodResolver } from '@hookform/resolvers/zod'
import { RecurrenceRule } from '@prisma/client'
import {
  ArrowRight,
  Camera,
  ChevronRight,
  MoreHorizontal,
  Save,
  Users,
  X,
} from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { UseFormReturn, useForm } from 'react-hook-form'
import { match } from 'ts-pattern'
import { DeletePopup } from '../../../../components/delete-popup'
import { extractCategoryFromTitle } from '../../../../components/expense-form-actions'
import { Textarea } from '../../../../components/ui/textarea'

const enforceCurrencyPattern = (value: string) =>
  value
    .replace(/^\s*-/, '_') // replace leading minus with _
    .replace(/[.,]/, '#') // replace first comma with #
    .replace(/[-.,]/g, '') // remove other minus and commas characters
    .replace(/_/, '-') // change back _ to minus
    .replace(/#/, '.') // change back # to dot
    .replace(/[^-\d.]/g, '') // remove all non-numeric characters

const enforcePositiveCurrencyPattern = (value: string) =>
  enforceCurrencyPattern(value).replace(/^-/, '')

const getDefaultSplittingOptions = (
  group: NonNullable<AppRouterOutput['groups']['get']['group']>,
) => {
  const defaultValue = {
    splitMode: 'EVENLY' as const,
    paidFor: group.participants.map(({ id }) => ({
      participant: id,
      shares: '1' as any, // Use string to ensure consistent schema handling
    })),
  }

  if (typeof localStorage === 'undefined') return defaultValue
  const defaultSplitMode = localStorage.getItem(
    `${group.id}-defaultSplittingOptions`,
  )
  if (defaultSplitMode === null) return defaultValue
  const parsedDefaultSplitMode = JSON.parse(
    defaultSplitMode,
  ) as SplittingOptions

  if (parsedDefaultSplitMode.paidFor === null) {
    parsedDefaultSplitMode.paidFor = defaultValue.paidFor
  }

  // if there is a participant in the default options that does not exist anymore,
  // remove the stale default splitting options
  for (const parsedPaidFor of parsedDefaultSplitMode.paidFor) {
    if (
      !group.participants.some(({ id }) => id === parsedPaidFor.participant)
    ) {
      localStorage.removeItem(`${group.id}-defaultSplittingOptions`)
      return defaultValue
    }
  }

  return {
    splitMode: parsedDefaultSplitMode.splitMode,
    paidFor: parsedDefaultSplitMode.paidFor.map((paidFor) => ({
      participant: paidFor.participant,
      shares: (paidFor.shares / 100).toString() as any, // Convert to string for consistent schema handling
    })),
  }
}

async function persistDefaultSplittingOptions(
  groupId: string,
  expenseFormValues: ExpenseFormValues,
) {
  if (localStorage && expenseFormValues.saveDefaultSplittingOptions) {
    const computePaidFor = (): SplittingOptions['paidFor'] => {
      if (expenseFormValues.splitMode === 'EVENLY') {
        return expenseFormValues.paidFor.map(({ participant }) => ({
          participant,
          shares: 100,
        }))
      } else if (expenseFormValues.splitMode === 'BY_AMOUNT') {
        return null
      } else {
        return expenseFormValues.paidFor
      }
    }

    const splittingOptions = {
      splitMode: expenseFormValues.splitMode,
      paidFor: computePaidFor(),
    } satisfies SplittingOptions

    localStorage.setItem(
      `${groupId}-defaultSplittingOptions`,
      JSON.stringify(splittingOptions),
    )
  }
}

export function ExpenseForm({
  group,
  categories,
  expense,
  onSubmit,
  onDelete,
  runtimeFeatureFlags,
}: {
  group: NonNullable<AppRouterOutput['groups']['get']['group']>
  categories: AppRouterOutput['categories']['list']['categories']
  expense?: AppRouterOutput['groups']['expenses']['get']['expense']
  onSubmit: (value: ExpenseFormValues, participantId?: string) => Promise<void>
  onDelete?: (participantId?: string) => Promise<void>
  runtimeFeatureFlags: RuntimeFeatureFlags
}) {
  const t = useTranslations('ExpenseForm')
  const locale = useLocale() as Locale
  const isCreate = expense === undefined
  const searchParams = useSearchParams()

  const getSelectedPayer = (field?: { value: string }) => {
    if (isCreate && typeof window !== 'undefined') {
      const activeUser = localStorage.getItem(`${group.id}-activeUser`)
      if (activeUser && activeUser !== 'None' && field?.value === undefined) {
        return activeUser
      }
    }
    return field?.value
  }

  const getSelectedRecurrenceRule = (field?: { value: string }) => {
    return field?.value as RecurrenceRule
  }
  const defaultSplittingOptions = getDefaultSplittingOptions(group)
  const groupCurrency = getCurrencyFromGroup(group)
  const receiptCurrencyCode = searchParams.get('currencyCode') || undefined
  const receiptAmount = Number(searchParams.get('amount')) || 0
  const receiptRequiresConversion =
    !!group.currencyCode &&
    !!receiptCurrencyCode &&
    receiptCurrencyCode !== group.currencyCode
  const repaymentPayerId =
    searchParams.get('from') ??
    getSelectedPayer() ??
    group.participants[0]?.id ??
    ''
  const repaymentRecipientId =
    searchParams.get('to') ??
    group.participants.find(({ id }) => id !== repaymentPayerId)?.id
  const initialEntryType: ExpenseEntryType = expense
    ? inferExpenseEntryType({
        amount: expense.amount,
        isReimbursement: expense.isReimbursement,
      })
    : searchParams.get('reimbursement')
      ? 'REPAYMENT'
      : 'EXPENSE'
  const [entryType, setEntryType] =
    useState<ExpenseEntryType>(initialEntryType)
  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseFormSchema),
    defaultValues: expense
      ? {
          title: expense.title,
          expenseDate: expense.expenseDate ?? new Date(),
          amount: amountAsDecimal(
            amountForEntryForm(expense.amount),
            groupCurrency,
          ),
          originalCurrency: expense.originalCurrency ?? group.currencyCode,
          originalAmount:
            expense.originalAmount === null || expense.originalAmount === undefined
              ? undefined
              : amountAsDecimal(
                  amountForEntryForm(expense.originalAmount),
                  getCurrency(expense.originalCurrency, locale, 'Custom'),
                ),
          conversionRate: expense.conversionRate?.toNumber(),
          category: expense.categoryId,
          paidBy: expense.paidById,
          paidFor: expense.paidFor.map(({ participantId, shares }) => ({
            participant: participantId,
            shares: (expense.splitMode === 'BY_AMOUNT'
              ? amountAsDecimal(shares, groupCurrency)
              : (shares / 100).toString()) as any, // Convert to string to ensure consistent handling
          })),
          splitMode: expense.splitMode,
          saveDefaultSplittingOptions: false,
          isReimbursement: expense.isReimbursement,
          documents: expense.documents,
          notes: expense.notes ?? '',
          recurrenceRule: expense.recurrenceRule ?? undefined,
        }
      : searchParams.get('reimbursement')
      ? {
          title: t('reimbursement'),
          expenseDate: new Date(),
          amount: amountAsDecimal(
            Number(searchParams.get('amount')) || 0,
            groupCurrency,
          ),
          originalCurrency: group.currencyCode,
          originalAmount: undefined,
          conversionRate: undefined,
          category: 1, // category with Id 1 is Payment
          paidBy: repaymentPayerId,
          paidFor: repaymentRecipientId
            ? [
                {
                  participant: repaymentRecipientId,
                  shares: '1' as any, // String for consistent form handling
                },
              ]
            : [],
          isReimbursement: true,
          splitMode: 'EVENLY',
          saveDefaultSplittingOptions: false,
          documents: [],
          notes: '',
          recurrenceRule: RecurrenceRule.NONE,
        }
      : {
          title: searchParams.get('title') ?? '',
          expenseDate: searchParams.get('date')
            ? new Date(searchParams.get('date') as string)
            : new Date(),
          amount: receiptRequiresConversion
            ? 0
            : amountForEntryForm(receiptAmount),
          originalCurrency: receiptCurrencyCode ?? group.currencyCode ?? undefined,
          originalAmount: receiptRequiresConversion
            ? amountForEntryForm(receiptAmount)
            : undefined,
          conversionRate: undefined,
          category: searchParams.get('categoryId')
            ? Number(searchParams.get('categoryId'))
            : 0, // category with Id 0 is General
          // paid for all, split evenly
          paidFor: defaultSplittingOptions.paidFor,
          paidBy: getSelectedPayer(),
          isReimbursement: false,
          splitMode: defaultSplittingOptions.splitMode,
          saveDefaultSplittingOptions: false,
          documents: searchParams.get('imageUrl')
            ? [
                {
                  id: randomId(),
                  url: searchParams.get('imageUrl') as string,
                  width: Number(searchParams.get('imageWidth')),
                  height: Number(searchParams.get('imageHeight')),
                },
              ]
            : [],
          notes: '',
          recurrenceRule: RecurrenceRule.NONE,
        },
  })
  const [isCategoryLoading, setCategoryLoading] = useState(false)
  const activeUserId = useActiveUser(group.id)

  const changeEntryType = (nextEntryType: ExpenseEntryType) => {
    if (nextEntryType === entryType) return

    const options = { shouldDirty: true }
    form.setValue(
      'amount',
      amountForEntryForm(Number(form.getValues('amount') || 0)),
      options,
    )
    const currentOriginalAmount = form.getValues('originalAmount')
    if (currentOriginalAmount !== undefined) {
      form.setValue(
        'originalAmount',
        amountForEntryForm(Number(currentOriginalAmount)),
        options,
      )
    }

    if (nextEntryType === 'REPAYMENT') {
      const payer =
        form.getValues('paidBy') ??
        getSelectedPayer() ??
        group.participants[0]?.id ??
        ''
      const currentRecipient = form.getValues('paidFor')[0]?.participant
      const recipient =
        currentRecipient && currentRecipient !== payer
          ? currentRecipient
          : group.participants.find(({ id }) => id !== payer)?.id

      form.setValue('title', t('Repayment.defaultTitle'), options)
      form.setValue('category', 1, options)
      form.setValue('paidBy', payer, options)
      form.setValue(
        'paidFor',
        recipient ? [{ participant: recipient, shares: '1' as any }] : [],
        options,
      )
      form.setValue('splitMode', 'EVENLY', options)
      form.setValue('saveDefaultSplittingOptions', false, options)
      form.setValue('isReimbursement', true, options)
      form.setValue('originalCurrency', group.currencyCode, options)
      form.setValue('originalAmount', undefined, options)
      form.setValue('conversionRate', undefined, options)
      form.setValue('recurrenceRule', RecurrenceRule.NONE, options)
    } else {
      if (entryType === 'REPAYMENT') {
        form.setValue('title', '', options)
        form.setValue('category', 0, options)
        form.setValue('paidFor', defaultSplittingOptions.paidFor, options)
        form.setValue('splitMode', defaultSplittingOptions.splitMode, options)
      }
      form.setValue('isReimbursement', false, options)
      if (!form.getValues('originalCurrency')) {
        form.setValue('originalCurrency', group.currencyCode, options)
      }
    }

    form.clearErrors()
    setEntryType(nextEntryType)
  }

  const submit = async (values: ExpenseFormValues) => {
    values.isReimbursement = entryType === 'REPAYMENT'
    values.amount = amountForEntryStorage(Number(values.amount), entryType)
    if (values.originalAmount !== undefined) {
      values.originalAmount = amountForEntryStorage(
        Number(values.originalAmount),
        entryType,
      )
    }

    if (entryType === 'REPAYMENT') {
      values.title = t('Repayment.defaultTitle')
      values.category = 1
      values.splitMode = 'EVENLY'
      values.saveDefaultSplittingOptions = false
      values.documents = []
      values.recurrenceRule = RecurrenceRule.NONE
      values.originalCurrency = group.currencyCode
      delete values.originalAmount
      delete values.conversionRate
    } else {
      await persistDefaultSplittingOptions(group.id, values)
    }

    // Store monetary amounts in minor units (cents)
    values.amount = amountAsMinorUnits(values.amount, groupCurrency)
    values.paidFor = values.paidFor.map(({ participant, shares }) => ({
      participant,
      shares:
        values.splitMode === 'BY_AMOUNT'
          ? amountAsMinorUnits(shares, groupCurrency)
          : shares,
    }))
    if (conversionRequired && values.originalAmount !== undefined) {
      values.originalAmount = amountAsMinorUnits(
        values.originalAmount,
        getCurrency(values.originalCurrency, locale, 'Custom'),
      )
    }

    // Currency should be blank if same as group currency
    if (!conversionRequired) {
      delete values.originalAmount
      delete values.originalCurrency
    }
    return onSubmit(values, activeUserId ?? undefined)
  }

  const [manuallyEditedParticipants, setManuallyEditedParticipants] = useState<
    Set<string>
  >(new Set())

  const sExpense = entryType === 'REFUND' ? 'Refund' : 'Expense'

  const originalCurrency = getCurrency(
    form.getValues('originalCurrency'),
    locale,
    'Custom',
  )
  const exchangeRate = useCurrencyRate(
    form.watch('expenseDate'),
    form.watch('originalCurrency') ?? '',
    groupCurrency.code,
  )

  const conversionRequired =
    group.currencyCode &&
    group.currencyCode.length &&
    originalCurrency.code.length &&
    originalCurrency.code !== group.currencyCode

  useEffect(() => {
    setManuallyEditedParticipants(new Set())
  }, [form.watch('splitMode'), form.watch('amount')])

  useEffect(() => {
    const splitMode = form.getValues().splitMode

    // Only auto-balance for split mode 'Unevenly - By amount'
    if (
      splitMode === 'BY_AMOUNT' &&
      (form.getFieldState('paidFor').isDirty ||
        form.getFieldState('amount').isDirty)
    ) {
      const totalAmount = Number(form.getValues().amount) || 0
      const paidFor = form.getValues().paidFor
      let newPaidFor = [...paidFor]

      const editedParticipants = Array.from(manuallyEditedParticipants)
      let remainingAmount = totalAmount
      let remainingParticipants = newPaidFor.length - editedParticipants.length

      newPaidFor = newPaidFor.map((participant) => {
        if (editedParticipants.includes(participant.participant)) {
          const participantShare = Number(participant.shares) || 0
          if (splitMode === 'BY_AMOUNT') {
            remainingAmount -= participantShare
          }
          return participant
        }
        return participant
      })

      if (remainingParticipants > 0) {
        let amountPerRemaining = 0
        if (splitMode === 'BY_AMOUNT') {
          amountPerRemaining = remainingAmount / remainingParticipants
        }

        newPaidFor = newPaidFor.map((participant) => {
          if (!editedParticipants.includes(participant.participant)) {
            return {
              ...participant,
              shares: amountPerRemaining.toFixed(
                groupCurrency.decimal_digits,
              ) as any, // Keep as string for consistent schema handling
            }
          }
          return participant
        })
      }
      form.setValue('paidFor', newPaidFor, { shouldValidate: true })
    }
  }, [
    manuallyEditedParticipants,
    form.watch('amount'),
    form.watch('splitMode'),
  ])

  const [usingCustomConversionRate, setUsingCustomConversionRate] = useState(
    !!form.formState.defaultValues?.conversionRate,
  )
  const [sharingOpen, setSharingOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)

  useEffect(() => {
    if (!usingCustomConversionRate && exchangeRate.data) {
      form.setValue('conversionRate', exchangeRate.data)
    }
  }, [exchangeRate.data, usingCustomConversionRate])

  useEffect(() => {
    if (
      !form.getFieldState('originalAmount').isTouched &&
      !receiptRequiresConversion
    )
      return
    const originalAmount = form.getValues('originalAmount') ?? 0
    const conversionRate = form.getValues('conversionRate')

    if (conversionRate && originalAmount) {
      const rate = Number(conversionRate)
      const convertedAmount = originalAmount * rate
      if (!Number.isNaN(convertedAmount)) {
        const v = enforcePositiveCurrencyPattern(
          convertedAmount.toFixed(groupCurrency.decimal_digits),
        )
        form.setValue('amount', Number(v))
      }
    }
  }, [
    form.watch('originalAmount'),
    form.watch('conversionRate'),
    form.getFieldState('originalAmount').isTouched,
    receiptRequiresConversion,
  ])

  let conversionRateMessage = ''
  if (exchangeRate.isLoading) {
    conversionRateMessage = t('conversionRateState.loading')
  } else {
    let ratesDisplay = ''
    if (exchangeRate.data) {
      // non breaking spaces so the rate text is not split with line feeds
      ratesDisplay = `${form.getValues('originalCurrency')}\xa01\xa0=\xa0${
        group.currencyCode
      }\xa0${exchangeRate.data}`
    }
    if (exchangeRate.error) {
      if (exchangeRate.error instanceof RangeError && exchangeRate.data)
        conversionRateMessage = t('conversionRateState.dateMismatch', {
          date: exchangeRate.error.message,
        })
      else {
        conversionRateMessage = t('conversionRateState.error')
      }
      conversionRateMessage +=
        ' ' +
        (ratesDisplay.length
          ? `${t('conversionRateState.staleRate')} ${ratesDisplay}`
          : t('conversionRateState.noRate'))
    } else {
      conversionRateMessage = ratesDisplay.length
        ? `${t('conversionRateState.success')} ${ratesDisplay}`
        : t('conversionRateState.currencyNotFound')
    }
  }

  const selectedPayerName =
    group.participants.find(({ id }) => id === form.watch('paidBy'))?.name ??
    t(`${sExpense}.paidByField.placeholder`)
  const selectedSplitModeLabel = match(form.watch('splitMode'))
    .with('EVENLY', () => t('SplitModeField.evenly'))
    .with('BY_SHARES', () => t('SplitModeField.byShares'))
    .with('BY_PERCENTAGE', () => t('SplitModeField.byPercentage'))
    .with('BY_AMOUNT', () => t('SplitModeField.byAmount'))
    .exhaustive()
  const selectedParticipantCount = form.watch('paidFor')?.length ?? 0

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)}>
        {isCreate ? (
          <>
            <div className="mx-auto max-w-xl space-y-5 pb-8">
              <header className="sticky top-0 z-10 -mx-4 flex items-center justify-between border-b bg-background/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:rounded-xl sm:border sm:px-3">
                <Button type="button" variant="ghost" size="icon" asChild>
                  <Link href={`/groups/${group.id}`}>
                    <X className="h-5 w-5" />
                    <span className="sr-only">{t('cancel')}</span>
                  </Link>
                </Button>
                <h1 className="text-lg font-semibold">
                  {entryType === 'REPAYMENT'
                    ? t('Repayment.create')
                    : t(`${sExpense}.create`)}
                </h1>
                <SubmitButton
                  size="sm"
                  loadingContent={t(isCreate ? 'creating' : 'saving')}
                >
                  <Save className="mr-1 h-4 w-4" />
                  {t('save')}
                </SubmitButton>
              </header>

              <EntryTypeSelector
                value={entryType}
                onValueChange={changeEntryType}
                repaymentDisabled={group.participants.length < 2}
              />

              {entryType === 'REPAYMENT' ? (
                <RepaymentFields
                  form={form}
                  group={group}
                  groupCurrency={groupCurrency}
                  isCreate
                />
              ) : (
                <>
              <section className="space-y-5 rounded-2xl border bg-card p-5 shadow-sm">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem className="space-y-0">
                      <FormLabel className="sr-only">
                        {t(`${sExpense}.TitleField.label`)}
                      </FormLabel>
                      <FormControl>
                        <Input
                          autoFocus
                          placeholder={t(`${sExpense}.TitleField.placeholder`)}
                          className="h-14 rounded-none border-x-0 border-t-0 px-0 text-xl shadow-none focus-visible:ring-0"
                          {...field}
                          onBlur={async () => {
                            field.onBlur()
                            if (runtimeFeatureFlags.enableCategoryExtract) {
                              setCategoryLoading(true)
                              const { categoryId } =
                                await extractCategoryFromTitle(field.value)
                              form.setValue('category', categoryId)
                              setCategoryLoading(false)
                            }
                          }}
                        />
                      </FormControl>
                      <FormMessage className="pt-1" />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="amount"
                  render={({ field: { onChange, value, ...field } }) => (
                    <FormItem className="space-y-0">
                      <FormLabel className="sr-only">
                        {t('amountField.label')}
                      </FormLabel>
                      <div className="flex items-baseline gap-3 border-b">
                        {group.currencyCode ? (
                          <FormField
                            name="originalCurrency"
                            render={({ field: currencyField }) => (
                              <FormControl>
                                <CurrencySelector
                                  currencies={defaultCurrencyList(locale, '')}
                                  defaultValue={currencyField.value ?? ''}
                                  isLoading={false}
                                  compact
                                  triggerClassName="h-11 shrink-0 rounded-lg"
                                  onValueChange={(currencyCode) => {
                                    if (
                                      !conversionRequired &&
                                      currencyCode !== group.currencyCode
                                    ) {
                                      form.setValue(
                                        'originalAmount',
                                        String(
                                          form.getValues('amount') || '',
                                        ) as any,
                                        {
                                          shouldDirty: true,
                                          shouldTouch: true,
                                        },
                                      )
                                    }
                                    currencyField.onChange(currencyCode)
                                  }}
                                />
                              </FormControl>
                            )}
                          />
                        ) : (
                          <span className="text-3xl text-muted-foreground">
                            {groupCurrency.symbol}
                          </span>
                        )}
                        <FormControl>
                          <Input
                            className="h-20 rounded-none border-0 px-0 text-5xl font-medium tracking-tight shadow-none focus-visible:ring-0"
                            type="text"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={
                              conversionRequired
                                ? form.watch('originalAmount') ?? ''
                                : value
                            }
                            onChange={(event) => {
                              const nextValue = enforcePositiveCurrencyPattern(
                                event.target.value,
                              )
                              if (conversionRequired) {
                                form.setValue(
                                  'originalAmount',
                                  nextValue as any,
                                  {
                                    shouldDirty: true,
                                    shouldTouch: true,
                                    shouldValidate: true,
                                  },
                                )
                              } else {
                                onChange(nextValue)
                              }
                            }}
                            onFocus={(event) => {
                              const target = event.currentTarget
                              setTimeout(() => target.select(), 1)
                            }}
                            {...field}
                          />
                        </FormControl>
                      </div>
                      <FormMessage className="pt-1" />
                    </FormItem>
                  )}
                />
              </section>

              <section className="grid gap-3 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="paidBy"
                  render={({ field }) => (
                    <FormItem className="col-span-1 space-y-0">
                      <FormLabel className="sr-only">
                        {t(`${sExpense}.paidByField.label`)}
                      </FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="h-auto min-h-16 justify-start gap-3 px-4 py-3 text-left">
                            <Users className="h-5 w-5 shrink-0 text-primary" />
                            <span className="!flex min-w-0 flex-1 flex-col !overflow-visible">
                              <span className="text-xs font-normal text-muted-foreground">
                                {t(`${sExpense}.paidByField.label`)}
                              </span>
                              <span className="truncate">
                                {selectedPayerName}
                              </span>
                            </span>
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {group.participants.map(({ id, name }) => (
                            <SelectItem key={id} value={id}>
                              {name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage className="sr-only" />
                    </FormItem>
                  )}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto min-h-16 justify-start gap-3 px-4 py-3 text-left"
                  onClick={() => setSharingOpen(true)}
                >
                  <Users className="h-5 w-5 shrink-0 text-primary" />
                  <span className="flex min-w-0 flex-col">
                    <span className="text-xs font-normal text-muted-foreground">
                      {t(`${sExpense}.paidFor.title`)}
                    </span>
                    <span className="truncate">
                      {selectedSplitModeLabel} · {selectedParticipantCount}
                    </span>
                  </span>
                </Button>
                <FormField
                  control={form.control}
                  name="expenseDate"
                  render={({ field }) => (
                    <FormItem className="col-span-1 min-w-0 space-y-0">
                      <FormLabel className="sr-only">
                        {t(`${sExpense}.DateField.label`)}
                      </FormLabel>
                      <DateInput
                        label={t(`${sExpense}.DateField.label`)}
                        value={field.value}
                        onChange={field.onChange}
                        variant="summary"
                      />
                      <FormMessage className="sr-only" />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem className="col-span-1 space-y-0">
                      <FormLabel className="sr-only">
                        {t('categoryField.label')}
                      </FormLabel>
                      <CategorySelector
                        categories={categories}
                        defaultValue={form.watch(field.name)}
                        onValueChange={field.onChange}
                        isLoading={isCategoryLoading}
                        variant="summary"
                        summaryLabel={t('categoryField.label')}
                      />
                      <FormMessage className="sr-only" />
                    </FormItem>
                  )}
                />
              </section>

              <Button
                type="button"
                variant="ghost"
                className="w-full justify-start gap-3 text-muted-foreground"
                onClick={() => setDetailsOpen(true)}
              >
                {runtimeFeatureFlags.enableExpenseDocuments ? (
                  <Camera className="h-5 w-5" />
                ) : (
                  <MoreHorizontal className="h-5 w-5" />
                )}
                {t('advancedOptions')}
              </Button>
                </>
              )}
            </div>

            {entryType !== 'REPAYMENT' && (
              <>
            <Dialog open={sharingOpen} onOpenChange={setSharingOpen}>
              <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>{t(`${sExpense}.paidFor.title`)}</DialogTitle>
                  <DialogDescription>
                    {t(`${sExpense}.paidFor.description`)}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-5">
                  <FormField
                    control={form.control}
                    name="splitMode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('SplitModeField.label')}</FormLabel>
                        <Select
                          value={field.value}
                          onValueChange={(value) => {
                            form.setValue('splitMode', value as any, {
                              shouldDirty: true,
                              shouldTouch: true,
                              shouldValidate: true,
                            })
                          }}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="EVENLY">
                              {t('SplitModeField.evenly')}
                            </SelectItem>
                            <SelectItem value="BY_SHARES">
                              {t('SplitModeField.byShares')}
                            </SelectItem>
                            <SelectItem value="BY_PERCENTAGE">
                              {t('SplitModeField.byPercentage')}
                            </SelectItem>
                            <SelectItem value="BY_AMOUNT">
                              {t('SplitModeField.byAmount')}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="paidFor"
                    render={({ field }) => (
                      <FormItem className="space-y-0 rounded-lg border">
                        <div className="flex items-center justify-between border-b px-3 py-2">
                          <FormLabel>{t(`${sExpense}.paidFor.title`)}</FormLabel>
                          <Button
                            type="button"
                            variant="link"
                            className="h-auto p-0"
                            onClick={() => {
                              const paidFor = field.value ?? []
                              const allSelected =
                                paidFor.length === group.participants.length
                              form.setValue(
                                'paidFor',
                                (allSelected
                                  ? []
                                  : group.participants.map((participant) => ({
                                      participant: participant.id,
                                      shares:
                                        paidFor.find(
                                          (value) =>
                                            value.participant === participant.id,
                                        )?.shares ?? '1',
                                    }))) as any,
                                {
                                  shouldDirty: true,
                                  shouldTouch: true,
                                  shouldValidate: true,
                                },
                              )
                            }}
                          >
                            {field.value?.length === group.participants.length
                              ? t('selectNone')
                              : t('selectAll')}
                          </Button>
                        </div>
                        {group.participants.map(({ id, name }) => {
                          const participantIndex =
                            field.value?.findIndex(
                              ({ participant }) => participant === id,
                            ) ?? -1
                          const selected = participantIndex >= 0
                          const splitMode = form.watch('splitMode')
                          return (
                            <div
                              key={id}
                              className="flex items-center gap-3 border-b px-3 py-3 last:border-b-0"
                            >
                              <Checkbox
                                checked={selected}
                                onCheckedChange={(checked) => {
                                  const values = field.value ?? []
                                  form.setValue(
                                    'paidFor',
                                    (checked
                                      ? [
                                          ...values,
                                          { participant: id, shares: '1' },
                                        ]
                                      : values.filter(
                                          (value) => value.participant !== id,
                                        )) as any,
                                    {
                                      shouldDirty: true,
                                      shouldTouch: true,
                                      shouldValidate: true,
                                    },
                                  )
                                }}
                              />
                              <span className="min-w-0 flex-1 truncate text-sm">
                                {name}
                              </span>
                              {selected && splitMode !== 'EVENLY' && (
                                <Input
                                  className="h-9 w-24 text-right"
                                  inputMode={
                                    splitMode === 'BY_AMOUNT'
                                      ? 'decimal'
                                      : 'numeric'
                                  }
                                  value={
                                    field.value?.[participantIndex]?.shares ?? ''
                                  }
                                  onChange={(event) => {
                                    form.setValue(
                                      'paidFor',
                                      field.value!.map((value) =>
                                        value.participant === id
                                          ? {
                                              ...value,
                                              shares: enforceCurrencyPattern(
                                                event.target.value,
                                              ),
                                            }
                                          : value,
                                      ) as any,
                                      {
                                        shouldDirty: true,
                                        shouldTouch: true,
                                        shouldValidate: true,
                                      },
                                    )
                                    setManuallyEditedParticipants((previous) =>
                                      new Set(previous).add(id),
                                    )
                                  }}
                                />
                              )}
                              {selected && splitMode !== 'EVENLY' && (
                                <span className="w-8 text-xs text-muted-foreground">
                                  {match(splitMode)
                                    .with('BY_SHARES', () => t('shares'))
                                    .with('BY_PERCENTAGE', () => '%')
                                    .with('BY_AMOUNT', () => group.currency)
                                    .otherwise(() => '')}
                                </span>
                              )}
                            </div>
                          )
                        })}
                        <FormMessage className="px-3 py-2" />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="saveDefaultSplittingOptions"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center gap-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <FormLabel className="font-normal">
                          {t('SplitModeField.saveAsDefault')}
                        </FormLabel>
                      </FormItem>
                    )}
                  />
                </div>
              </DialogContent>
            </Dialog>

            <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
              <DialogContent
                className="max-h-[85dvh] overflow-y-auto sm:max-w-lg"
                onOpenAutoFocus={(event) => event.preventDefault()}
              >
                <DialogHeader>
                  <DialogTitle>{t('advancedOptions')}</DialogTitle>
                  <DialogDescription>
                    {t(`${sExpense}.TitleField.description`)}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-5">
                  {conversionRequired && (
                    <>
                      <FormField
                        control={form.control}
                        name="originalAmount"
                        render={({ field: { onChange, ...field } }) => (
                          <FormItem>
                            <FormLabel>{t('originalAmountField.label')}</FormLabel>
                            <div className="flex items-baseline gap-2">
                              <span>{originalCurrency.symbol}</span>
                              <FormControl>
                                <Input
                                  type="text"
                                  inputMode="decimal"
                                  placeholder="0.00"
                                  onChange={(event) =>
                                    onChange(
                                      enforcePositiveCurrencyPattern(
                                        event.target.value,
                                      ),
                                    )
                                  }
                                  {...field}
                                />
                              </FormControl>
                            </div>
                            <FormDescription>
                              {conversionRateMessage}
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          setUsingCustomConversionRate((value) => !value)
                        }
                      >
                        {usingCustomConversionRate
                          ? t('conversionRateField.useApi')
                          : t('conversionRateField.useCustom')}
                      </Button>
                      {usingCustomConversionRate && (
                        <FormField
                          control={form.control}
                          name="conversionRate"
                          render={({ field: { onChange, ...field } }) => (
                            <FormItem>
                              <FormLabel>
                                {t('conversionRateField.label')}
                              </FormLabel>
                              <FormControl>
                                <Input
                                  type="text"
                                  inputMode="decimal"
                                  onChange={(event) =>
                                    onChange(
                                      enforcePositiveCurrencyPattern(
                                        event.target.value,
                                      ),
                                    )
                                  }
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      )}
                    </>
                  )}

                  <FormField
                    control={form.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('notesField.label')}</FormLabel>
                        <FormControl>
                          <Textarea className="text-base" {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="recurrenceRule"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t(`${sExpense}.recurrenceRule.label`)}
                        </FormLabel>
                        <Select
                          value={getSelectedRecurrenceRule(field) ?? 'NONE'}
                          onValueChange={(value) =>
                            form.setValue(
                              'recurrenceRule',
                              value as RecurrenceRule,
                            )
                          }
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="NONE">
                              {t(`${sExpense}.recurrenceRule.none`)}
                            </SelectItem>
                            <SelectItem value="DAILY">
                              {t(`${sExpense}.recurrenceRule.daily`)}
                            </SelectItem>
                            <SelectItem value="WEEKLY">
                              {t(`${sExpense}.recurrenceRule.weekly`)}
                            </SelectItem>
                            <SelectItem value="MONTHLY">
                              {t(`${sExpense}.recurrenceRule.monthly`)}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />

                  {runtimeFeatureFlags.enableExpenseDocuments && (
                    <FormField
                      control={form.control}
                      name="documents"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('attachDocuments')}</FormLabel>
                          <ExpenseDocumentsInput
                            documents={field.value}
                            updateDocuments={field.onChange}
                          />
                        </FormItem>
                      )}
                    />
                  )}
                </div>
              </DialogContent>
            </Dialog>
              </>
            )}
          </>
        ) : entryType === 'REPAYMENT' ? (
          <div className="mx-auto max-w-xl space-y-5 pb-8">
            <Card>
              <CardHeader>
                <CardTitle>{t('Repayment.edit')}</CardTitle>
                <CardDescription>{t('Repayment.description')}</CardDescription>
              </CardHeader>
              <CardContent>
                <EntryTypeSelector
                  value={entryType}
                  onValueChange={changeEntryType}
                  repaymentDisabled={group.participants.length < 2}
                />
              </CardContent>
            </Card>
            <RepaymentFields
              form={form}
              group={group}
              groupCurrency={groupCurrency}
              isCreate={false}
            />
            <div className="flex gap-2">
              <SubmitButton loadingContent={t('saving')}>
                <Save className="mr-2 h-4 w-4" />
                {t('save')}
              </SubmitButton>
              {onDelete && (
                <DeletePopup
                  onDelete={() => onDelete(activeUserId ?? undefined)}
                />
              )}
              <Button variant="ghost" asChild>
                <Link href={`/groups/${group.id}`}>{t('cancel')}</Link>
              </Button>
            </div>
          </div>
        ) : (
          <>
        <Card>
          <CardHeader>
            <CardTitle>
              {t(`${sExpense}.${isCreate ? 'create' : 'edit'}`)}
            </CardTitle>
            <EntryTypeSelector
              value={entryType}
              onValueChange={changeEntryType}
              repaymentDisabled={group.participants.length < 2}
            />
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-6">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem className="">
                  <FormLabel>{t(`${sExpense}.TitleField.label`)}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t(`${sExpense}.TitleField.placeholder`)}
                      className="text-base"
                      {...field}
                      onBlur={async () => {
                        field.onBlur() // avoid skipping other blur event listeners since we overwrite `field`
                        if (runtimeFeatureFlags.enableCategoryExtract) {
                          setCategoryLoading(true)
                          const { categoryId } = await extractCategoryFromTitle(
                            field.value,
                          )
                          form.setValue('category', categoryId)
                          setCategoryLoading(false)
                        }
                      }}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(`${sExpense}.TitleField.description`)}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="expenseDate"
              render={({ field }) => (
                <FormItem className="sm:order-1">
                  <FormLabel>{t(`${sExpense}.DateField.label`)}</FormLabel>
                  <DateInput
                    label={t(`${sExpense}.DateField.label`)}
                    value={field.value}
                    onChange={field.onChange}
                  />
                  <FormDescription>
                    {t(`${sExpense}.DateField.description`)}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              name="originalCurrency"
              render={({ field: { onChange, ...field } }) => (
                <FormItem className="sm:order-3">
                  <FormLabel>{t(`${sExpense}.currencyField.label`)}</FormLabel>
                  <FormControl>
                    {group.currencyCode ? (
                      <CurrencySelector
                        currencies={defaultCurrencyList(locale, '')}
                        defaultValue={form.watch(field.name) ?? ''}
                        isLoading={false}
                        onValueChange={(v) => onChange(v)}
                      />
                    ) : (
                      <Input
                        className="text-base"
                        disabled={true}
                        {...field}
                        placeholder={group.currency}
                      />
                    )}
                  </FormControl>
                  <FormDescription>
                    {t(`${sExpense}.currencyField.description`)}{' '}
                    {!group.currencyCode && t('conversionUnavailable')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div
              className={`sm:order-4 ${
                !conversionRequired ? 'max-sm:hidden sm:invisible' : ''
              } col-span-2 md:col-span-1 space-y-2`}
            >
              <FormField
                control={form.control}
                name="originalAmount"
                render={({ field: { onChange, ...field } }) => (
                  <FormItem>
                    <FormLabel>{t('originalAmountField.label')}</FormLabel>
                    <div className="flex items-baseline gap-2">
                      <span>{originalCurrency.symbol}</span>
                      <FormControl>
                        <Input
                          className="text-base max-w-[120px]"
                          type="text"
                          inputMode="decimal"
                          placeholder="0.00"
                          onChange={(event) => {
                            const v = enforcePositiveCurrencyPattern(
                              event.target.value,
                            )
                            onChange(v)
                          }}
                          {...field}
                          onFocus={(e) => {
                            const target = e.currentTarget
                            setTimeout(() => target.select(), 1)
                          }}
                        />
                      </FormControl>
                    </div>
                    <FormDescription>
                      {isNaN(form.getValues('expenseDate').getTime()) ? (
                        t('conversionRateState.noDate')
                      ) : form.getValues('expenseDate') &&
                        !usingCustomConversionRate ? (
                        <>
                          {conversionRateMessage}
                          {!exchangeRate.isLoading && (
                            <Button
                              className="h-auto py-0"
                              variant="link"
                              onClick={() => exchangeRate.refresh()}
                            >
                              {t('conversionRateState.refresh')}
                            </Button>
                          )}
                        </>
                      ) : (
                        t('conversionRateState.customRate')
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Collapsible
                open={usingCustomConversionRate}
                onOpenChange={setUsingCustomConversionRate}
              >
                <CollapsibleTrigger asChild>
                  <Button variant="link" className="-mx-4">
                    {usingCustomConversionRate
                      ? t('conversionRateField.useApi')
                      : t('conversionRateField.useCustom')}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <FormField
                    control={form.control}
                    name="conversionRate"
                    render={({ field: { onChange, ...field } }) => (
                      <FormItem
                        className={`sm:order-4 ${
                          !conversionRequired
                            ? 'max-sm:hidden sm:invisible'
                            : ''
                        }`}
                      >
                        <FormLabel>{t('conversionRateField.label')}</FormLabel>
                        <div className="flex items-baseline gap-2">
                          <span>
                            {originalCurrency.symbol} 1 = {group.currency}
                          </span>
                          <FormControl>
                            <Input
                              className="text-base max-w-[120px]"
                              type="text"
                              inputMode="decimal"
                              placeholder="0.00"
                              onChange={(event) => {
                                const v = enforcePositiveCurrencyPattern(
                                  event.target.value,
                                )
                                onChange(v)
                              }}
                              {...field}
                              onFocus={(e) => {
                                const target = e.currentTarget
                                setTimeout(() => target.select(), 1)
                              }}
                            />
                          </FormControl>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CollapsibleContent>
              </Collapsible>
            </div>
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem className="order-3 sm:order-2">
                  <FormLabel>{t('categoryField.label')}</FormLabel>
                  <CategorySelector
                    categories={categories}
                    defaultValue={
                      form.watch(field.name) // may be overwritten externally
                    }
                    onValueChange={field.onChange}
                    isLoading={isCategoryLoading}
                  />
                  <FormDescription>
                    {t(`${sExpense}.categoryFieldDescription`)}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="amount"
              render={({ field: { onChange, ...field } }) => (
                <FormItem className="sm:order-5">
                  <FormLabel>{t('amountField.label')}</FormLabel>
                  <div className="flex items-baseline gap-2">
                    <span>{group.currency}</span>
                    <FormControl>
                      <Input
                        className="text-base max-w-[120px]"
                        type="text"
                        inputMode="decimal"
                        placeholder="0.00"
                        onChange={(event) => {
                          const v = enforcePositiveCurrencyPattern(
                            event.target.value,
                          )
                          onChange(v)
                        }}
                        onFocus={(e) => {
                          // we're adding a small delay to get around safaris issue with onMouseUp deselecting things again
                          const target = e.currentTarget
                          setTimeout(() => target.select(), 1)
                        }}
                        {...field}
                      />
                    </FormControl>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="paidBy"
              render={({ field }) => (
                <FormItem className="sm:order-5">
                  <FormLabel>{t(`${sExpense}.paidByField.label`)}</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={getSelectedPayer(field)}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={t(`${sExpense}.paidByField.placeholder`)}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {group.participants.map(({ id, name }) => (
                        <SelectItem key={id} value={id}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    {t(`${sExpense}.paidByField.description`)}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem className="sm:order-6">
                  <FormLabel>{t('notesField.label')}</FormLabel>
                  <FormControl>
                    <Textarea className="text-base" {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="recurrenceRule"
              render={({ field }) => (
                <FormItem className="sm:order-5">
                  <FormLabel>{t(`${sExpense}.recurrenceRule.label`)}</FormLabel>
                  <Select
                    onValueChange={(value) => {
                      form.setValue('recurrenceRule', value as RecurrenceRule)
                    }}
                    defaultValue={getSelectedRecurrenceRule(field)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="NONE" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">
                        {t(`${sExpense}.recurrenceRule.none`)}
                      </SelectItem>
                      <SelectItem value="DAILY">
                        {t(`${sExpense}.recurrenceRule.daily`)}
                      </SelectItem>
                      <SelectItem value="WEEKLY">
                        {t(`${sExpense}.recurrenceRule.weekly`)}
                      </SelectItem>
                      <SelectItem value="MONTHLY">
                        {t(`${sExpense}.recurrenceRule.monthly`)}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    {t(`${sExpense}.recurrenceRule.description`)}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="flex justify-between">
              <span>{t(`${sExpense}.paidFor.title`)}</span>
              <Button
                variant="link"
                type="button"
                className="-my-2 -mx-4"
                onClick={() => {
                  const paidFor = form.getValues().paidFor
                  const allSelected =
                    paidFor.length === group.participants.length
                  const newPaidFor = allSelected
                    ? []
                    : group.participants.map((p) => ({
                        participant: p.id,
                        shares: (paidFor.find(
                          (pfor) => pfor.participant === p.id,
                        )?.shares ?? '1') as any, // Use string to ensure consistent schema handling
                      }))
                  form.setValue('paidFor', newPaidFor as any, {
                    shouldDirty: true,
                    shouldTouch: true,
                    shouldValidate: true,
                  })
                }}
              >
                {form.getValues().paidFor.length ===
                group.participants.length ? (
                  <>{t('selectNone')}</>
                ) : (
                  <>{t('selectAll')}</>
                )}
              </Button>
            </CardTitle>
            <CardDescription>
              {t(`${sExpense}.paidFor.description`)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FormField
              control={form.control}
              name="paidFor"
              render={() => (
                <FormItem className="sm:order-4 row-span-2 space-y-0">
                  {group.participants.map(({ id, name }) => (
                    <FormField
                      key={id}
                      control={form.control}
                      name="paidFor"
                      render={({ field }) => {
                        return (
                          <div
                            data-id={`${id}/${form.getValues().splitMode}/${
                              group.currency
                            }`}
                            className="flex flex-wrap gap-y-4 items-center border-t last-of-type:border-b last-of-type:!mb-4 -mx-6 px-6 py-3"
                          >
                            <FormItem className="flex-1 flex flex-row items-start space-x-3 space-y-0">
                              <FormControl>
                                <Checkbox
                                  checked={field.value?.some(
                                    ({ participant }) => participant === id,
                                  )}
                                  onCheckedChange={(checked) => {
                                    const options = {
                                      shouldDirty: true,
                                      shouldTouch: true,
                                      shouldValidate: true,
                                    }
                                    checked
                                      ? form.setValue(
                                          'paidFor',
                                          [
                                            ...field.value,
                                            {
                                              participant: id,
                                              shares: '1', // Use string to ensure consistent schema handling
                                            },
                                          ] as any,
                                          options,
                                        )
                                      : form.setValue(
                                          'paidFor',
                                          field.value?.filter(
                                            (value) => value.participant !== id,
                                          ),
                                          options,
                                        )
                                  }}
                                />
                              </FormControl>
                              <FormLabel className="text-sm font-normal flex-1">
                                {name}
                                {field.value?.some(
                                  ({ participant }) => participant === id,
                                ) &&
                                  !form.watch('isReimbursement') && (
                                    <span className="text-muted-foreground ml-2">
                                      (
                                      {formatCurrency(
                                        groupCurrency,
                                        calculateShare(id, {
                                          amount: amountAsMinorUnits(
                                            amountForEntryStorage(
                                              Number(form.watch('amount')),
                                              entryType,
                                            ),
                                            groupCurrency,
                                          ), // Convert to cents
                                          paidFor: field.value.map(
                                            ({ participant, shares }) => ({
                                              participant: {
                                                id: participant,
                                                name: '',
                                                groupId: '',
                                              },
                                              shares:
                                                form.watch('splitMode') ===
                                                'BY_PERCENTAGE'
                                                  ? Number(shares) * 100 // Convert percentage to basis points (e.g., 50% -> 5000)
                                                  : form.watch('splitMode') ===
                                                    'BY_AMOUNT'
                                                  ? amountAsMinorUnits(
                                                      shares,
                                                      groupCurrency,
                                                    )
                                                  : shares,
                                              expenseId: '',
                                              participantId: '',
                                            }),
                                          ),
                                          splitMode: form.watch('splitMode'),
                                          isReimbursement:
                                            form.watch('isReimbursement'),
                                        }),
                                        locale,
                                      )}
                                      )
                                    </span>
                                  )}
                              </FormLabel>
                            </FormItem>
                            <div className="flex">
                              {form.getValues().splitMode === 'BY_AMOUNT' &&
                                !!conversionRequired && (
                                  <FormField
                                    name={`paidFor[${field.value.findIndex(
                                      ({ participant }) => participant === id,
                                    )}].originalAmount`}
                                    render={() => {
                                      const sharesLabel = (
                                        <span
                                          className={cn('text-sm', {
                                            'text-muted': !field.value?.some(
                                              ({ participant }) =>
                                                participant === id,
                                            ),
                                          })}
                                        >
                                          {originalCurrency.symbol}
                                        </span>
                                      )
                                      return (
                                        <div>
                                          <div className="flex gap-1 items-center">
                                            {sharesLabel}
                                            <FormControl>
                                              <Input
                                                key={String(
                                                  !field.value?.some(
                                                    ({ participant }) =>
                                                      participant === id,
                                                  ),
                                                )}
                                                className="text-base w-[80px] -my-2"
                                                type="text"
                                                inputMode="decimal"
                                                disabled={
                                                  !field.value?.some(
                                                    ({ participant }) =>
                                                      participant === id,
                                                  )
                                                }
                                                value={
                                                  field.value.find(
                                                    ({ participant }) =>
                                                      participant === id,
                                                  )?.originalAmount ?? ''
                                                }
                                                onChange={(event) => {
                                                  const originalAmount = Number(
                                                    event.target.value,
                                                  )
                                                  let convertedAmount = ''
                                                  if (
                                                    !Number.isNaN(
                                                      originalAmount,
                                                    ) &&
                                                    exchangeRate.data
                                                  ) {
                                                    convertedAmount = (
                                                      originalAmount *
                                                      exchangeRate.data
                                                    ).toFixed(
                                                      groupCurrency.decimal_digits,
                                                    )
                                                  }
                                                  field.onChange(
                                                    field.value.map((p) =>
                                                      p.participant === id
                                                        ? {
                                                            participant: id,
                                                            originalAmount:
                                                              event.target
                                                                .value,
                                                            shares:
                                                              enforceCurrencyPattern(
                                                                convertedAmount,
                                                              ),
                                                          }
                                                        : p,
                                                    ),
                                                  )
                                                  setManuallyEditedParticipants(
                                                    (prev) =>
                                                      new Set(prev).add(id),
                                                  )
                                                }}
                                                step={
                                                  10 **
                                                  -originalCurrency.decimal_digits
                                                }
                                              />
                                            </FormControl>
                                            <ChevronRight className="h-4 w-4 mx-1 opacity-50" />
                                          </div>
                                        </div>
                                      )
                                    }}
                                  />
                                )}
                              {form.getValues().splitMode !== 'EVENLY' && (
                                <FormField
                                  name={`paidFor[${field.value.findIndex(
                                    ({ participant }) => participant === id,
                                  )}].shares`}
                                  render={() => {
                                    const sharesLabel = (
                                      <span
                                        className={cn('text-sm', {
                                          'text-muted': !field.value?.some(
                                            ({ participant }) =>
                                              participant === id,
                                          ),
                                        })}
                                      >
                                        {match(form.getValues().splitMode)
                                          .with('BY_SHARES', () => (
                                            <>{t('shares')}</>
                                          ))
                                          .with('BY_PERCENTAGE', () => <>%</>)
                                          .with('BY_AMOUNT', () => (
                                            <>{group.currency}</>
                                          ))
                                          .otherwise(() => (
                                            <></>
                                          ))}
                                      </span>
                                    )
                                    return (
                                      <div>
                                        <div className="flex gap-1 items-center">
                                          {form.getValues().splitMode ===
                                            'BY_AMOUNT' && sharesLabel}
                                          <FormControl>
                                            <Input
                                              key={String(
                                                !field.value?.some(
                                                  ({ participant }) =>
                                                    participant === id,
                                                ),
                                              )}
                                              className="text-base w-[80px] -my-2"
                                              type="text"
                                              disabled={
                                                !field.value?.some(
                                                  ({ participant }) =>
                                                    participant === id,
                                                )
                                              }
                                              value={
                                                field.value?.find(
                                                  ({ participant }) =>
                                                    participant === id,
                                                )?.shares
                                              }
                                              onChange={(event) => {
                                                field.onChange(
                                                  field.value.map((p) =>
                                                    p.participant === id
                                                      ? {
                                                          participant: id,
                                                          shares:
                                                            enforceCurrencyPattern(
                                                              event.target
                                                                .value,
                                                            ),
                                                        }
                                                      : p,
                                                  ),
                                                )
                                                setManuallyEditedParticipants(
                                                  (prev) =>
                                                    new Set(prev).add(id),
                                                )
                                              }}
                                              inputMode={
                                                form.getValues().splitMode ===
                                                'BY_AMOUNT'
                                                  ? 'decimal'
                                                  : 'numeric'
                                              }
                                              step={
                                                form.getValues().splitMode ===
                                                'BY_AMOUNT'
                                                  ? 10 **
                                                    -groupCurrency.decimal_digits
                                                  : 1
                                              }
                                            />
                                          </FormControl>
                                          {[
                                            'BY_SHARES',
                                            'BY_PERCENTAGE',
                                          ].includes(
                                            form.getValues().splitMode,
                                          ) && sharesLabel}
                                        </div>
                                        <FormMessage className="float-right" />
                                      </div>
                                    )
                                  }}
                                />
                              )}
                            </div>
                          </div>
                        )
                      }}
                    />
                  ))}
                  <FormMessage />
                </FormItem>
              )}
            />

            <Collapsible
              className="mt-5"
              defaultOpen={form.getValues().splitMode !== 'EVENLY'}
            >
              <CollapsibleTrigger asChild>
                <Button variant="link" className="-mx-4">
                  {t('advancedOptions')}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="grid sm:grid-cols-2 gap-6 pt-3">
                  <FormField
                    control={form.control}
                    name="splitMode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('SplitModeField.label')}</FormLabel>
                        <FormControl>
                          <Select
                            onValueChange={(value) => {
                              form.setValue('splitMode', value as any, {
                                shouldDirty: true,
                                shouldTouch: true,
                                shouldValidate: true,
                              })
                            }}
                            defaultValue={field.value}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="EVENLY">
                                {t('SplitModeField.evenly')}
                              </SelectItem>
                              <SelectItem value="BY_SHARES">
                                {t('SplitModeField.byShares')}
                              </SelectItem>
                              <SelectItem value="BY_PERCENTAGE">
                                {t('SplitModeField.byPercentage')}
                              </SelectItem>
                              <SelectItem value="BY_AMOUNT">
                                {t('SplitModeField.byAmount')}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </FormControl>
                        <FormDescription>
                          {t(`${sExpense}.splitModeDescription`)}
                        </FormDescription>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="saveDefaultSplittingOptions"
                    render={({ field }) => (
                      <FormItem className="flex flex-row gap-2 items-center space-y-0 pt-2">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div>
                          <FormLabel>
                            {t('SplitModeField.saveAsDefault')}
                          </FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        </Card>

        {runtimeFeatureFlags.enableExpenseDocuments && (
          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="flex justify-between">
                <span>{t('attachDocuments')}</span>
              </CardTitle>
              <CardDescription>
                {t(`${sExpense}.attachDescription`)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FormField
                control={form.control}
                name="documents"
                render={({ field }) => (
                  <ExpenseDocumentsInput
                    documents={field.value}
                    updateDocuments={field.onChange}
                  />
                )}
              />
            </CardContent>
          </Card>
        )}

        <div className="flex mt-4 gap-2">
          <SubmitButton loadingContent={t(isCreate ? 'creating' : 'saving')}>
            <Save className="w-4 h-4 mr-2" />
            {t(isCreate ? 'create' : 'save')}
          </SubmitButton>
          {!isCreate && onDelete && (
            <DeletePopup
              onDelete={() => onDelete(activeUserId ?? undefined)}
            ></DeletePopup>
          )}
          <Button variant="ghost" asChild>
            <Link href={`/groups/${group.id}`}>{t('cancel')}</Link>
          </Button>
        </div>
          </>
        )}
      </form>
    </Form>
  )
}

function EntryTypeSelector({
  value,
  onValueChange,
  repaymentDisabled,
}: {
  value: ExpenseEntryType
  onValueChange: (value: ExpenseEntryType) => void
  repaymentDisabled: boolean
}) {
  const t = useTranslations('ExpenseForm.entryType')
  const entries: { value: ExpenseEntryType; label: string }[] = [
    { value: 'EXPENSE', label: t('expense') },
    { value: 'REFUND', label: t('refund') },
    { value: 'REPAYMENT', label: t('repayment') },
  ]

  return (
    <div
      role="radiogroup"
      aria-label={t('label')}
      className="grid grid-cols-3 gap-1 rounded-xl border bg-muted/40 p-1"
    >
      {entries.map((entry) => (
        <Button
          key={entry.value}
          type="button"
          role="radio"
          aria-checked={value === entry.value}
          variant={value === entry.value ? 'secondary' : 'ghost'}
          className={cn(
            'h-10 px-2',
            value === entry.value && 'bg-background shadow-sm',
          )}
          disabled={entry.value === 'REPAYMENT' && repaymentDisabled}
          onClick={() => onValueChange(entry.value)}
        >
          {entry.label}
        </Button>
      ))}
    </div>
  )
}

function RepaymentFields({
  form,
  group,
  groupCurrency,
  isCreate,
}: {
  form: UseFormReturn<ExpenseFormValues>
  group: NonNullable<AppRouterOutput['groups']['get']['group']>
  groupCurrency: ReturnType<typeof getCurrencyFromGroup>
  isCreate: boolean
}) {
  const t = useTranslations('ExpenseForm.Repayment')
  const payer = form.watch('paidBy')
  const recipient = form.watch('paidFor')?.[0]?.participant
  const participantName = (id?: string) =>
    group.participants.find((participant) => participant.id === id)?.name

  return (
    <>
      <section className="space-y-5 rounded-2xl border bg-card p-5 shadow-sm">
        <p className="text-sm text-muted-foreground">{t('description')}</p>
        <FormField
          control={form.control}
          name="amount"
          render={({ field: { onChange, ...field } }) => (
            <FormItem className="space-y-0">
              <FormLabel className="sr-only">{t('amount')}</FormLabel>
              <div className="flex items-baseline gap-3 border-b">
                <span className="text-3xl text-muted-foreground">
                  {groupCurrency.symbol}
                </span>
                <FormControl>
                  <Input
                    autoFocus={isCreate}
                    className="h-20 rounded-none border-0 px-0 text-5xl font-medium tracking-tight shadow-none focus-visible:ring-0"
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    onChange={(event) =>
                      onChange(
                        enforcePositiveCurrencyPattern(event.target.value),
                      )
                    }
                    onFocus={(event) => {
                      const target = event.currentTarget
                      setTimeout(() => target.select(), 1)
                    }}
                    {...field}
                  />
                </FormControl>
              </div>
              <FormMessage className="pt-1" />
            </FormItem>
          )}
        />
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="paidBy"
          render={({ field }) => (
            <FormItem className="col-span-1 space-y-0">
              <FormLabel className="sr-only">{t('from')}</FormLabel>
              <Select
                value={field.value}
                onValueChange={(participantId) => {
                  field.onChange(participantId)
                  if (recipient === participantId) {
                    const replacement = group.participants.find(
                      ({ id }) => id !== participantId,
                    )?.id
                    form.setValue(
                      'paidFor',
                      replacement
                        ? [{ participant: replacement, shares: '1' as any }]
                        : [],
                      { shouldDirty: true, shouldValidate: true },
                    )
                  }
                }}
              >
                <FormControl>
                  <SelectTrigger className="h-auto min-h-16 justify-start gap-3 px-4 py-3 text-left">
                    <Users className="h-5 w-5 shrink-0 text-primary" />
                    <span className="!flex min-w-0 flex-1 flex-col !overflow-visible">
                      <span className="text-xs font-normal text-muted-foreground">
                        {t('from')}
                      </span>
                      <span className="truncate">
                        {participantName(field.value) ?? t('from')}
                      </span>
                    </span>
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {group.participants.map(({ id, name }) => (
                    <SelectItem key={id} value={id}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage className="sr-only" />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="paidFor"
          render={({ field }) => (
            <FormItem className="col-span-1 space-y-0">
              <FormLabel className="sr-only">{t('to')}</FormLabel>
              <Select
                value={recipient}
                onValueChange={(participantId) =>
                  field.onChange([
                    { participant: participantId, shares: '1' as any },
                  ])
                }
              >
                <FormControl>
                  <SelectTrigger className="h-auto min-h-16 justify-start gap-3 px-4 py-3 text-left">
                    <ArrowRight className="h-5 w-5 shrink-0 text-primary" />
                    <span className="!flex min-w-0 flex-1 flex-col !overflow-visible">
                      <span className="text-xs font-normal text-muted-foreground">
                        {t('to')}
                      </span>
                      <span className="truncate">
                        {participantName(recipient) ?? t('to')}
                      </span>
                    </span>
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {group.participants.map(({ id, name }) => (
                    <SelectItem key={id} value={id} disabled={id === payer}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage className="sr-only" />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="expenseDate"
          render={({ field }) => (
            <FormItem className="col-span-1 min-w-0 space-y-0 sm:col-span-2">
              <FormLabel className="sr-only">{t('date')}</FormLabel>
              <DateInput
                label={t('date')}
                value={field.value}
                onChange={field.onChange}
                variant="summary"
              />
              <FormMessage className="sr-only" />
            </FormItem>
          )}
        />
      </section>

      <section className="rounded-2xl border bg-card p-5 shadow-sm">
        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('notes')}</FormLabel>
              <FormControl>
                <Textarea className="text-base" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </section>
    </>
  )
}
