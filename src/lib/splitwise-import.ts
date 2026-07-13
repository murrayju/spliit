import { normalizeString } from './utils'

const REQUIRED_COLUMNS = ['Date', 'Description', 'Category', 'Cost', 'Currency']

export const SPLITWISE_IMPORT_SKIP_REASONS = [
  'settled',
  'multiplePayers',
  'invalidExpense',
] as const

export type SplitwiseImportSkipReason =
  (typeof SPLITWISE_IMPORT_SKIP_REASONS)[number]

export type PreparedSplitwiseExpense = {
  expenseDate: Date
  title: string
  categoryId: number
  amount: number
  originalAmount?: number
  originalCurrency?: string
  conversionRate?: number
  paidById: string
  paidFor: { participantId: string; shares: number }[]
}

type GroupForImport = {
  currencyCode: string | null
  participants: { id: string; name: string }[]
}

type CategoryForImport = { id: number; name: string }

type CurrencyRateLookup = (
  baseCurrency: string,
  targetCurrency: string,
) => Promise<number>

type ParsedSplitwiseRow = {
  rowNumber: number
  date: string
  title: string
  category: string
  cost: string
  currency: string
  participantBalances: { name: string; amount: string }[]
}

export type PreparedSplitwiseImport = {
  expenses: PreparedSplitwiseExpense[]
  skipped: Record<SplitwiseImportSkipReason, number>
}

export class SplitwiseCsvError extends Error {}

/**
 * Converts a standard Splitwise CSV export into Spliit expenses.
 *
 * Splitwise exports each participant's net change for an expense, rather than
 * the original per-person share. A row with one positive balance can be
 * recreated exactly in Spliit: that participant is the payer, negative values
 * are the other participants' shares, and the payer receives the remainder.
 * Foreign-currency expenses are converted with the supplied current rate while
 * retaining their original amount, currency, and the rate that was used.
 */
export async function prepareSplitwiseImport(
  csv: string,
  group: GroupForImport,
  categories: CategoryForImport[],
  getCurrencyRate: CurrencyRateLookup,
): Promise<PreparedSplitwiseImport> {
  const rows = parseSplitwiseCsv(csv)
  const groupCurrency = group.currencyCode?.trim().toUpperCase()

  if (!groupCurrency || !/^[A-Z]{3}$/.test(groupCurrency)) {
    throw new SplitwiseCsvError(
      'Set a three-letter main currency for this group before importing a Splitwise CSV.',
    )
  }

  const participantsByName = new Map<
    string,
    GroupForImport['participants'][0]
  >()
  for (const participant of group.participants) {
    const key = normalizeParticipantName(participant.name)
    if (participantsByName.has(key)) {
      throw new SplitwiseCsvError(
        `The group has ambiguous participant names: ${participant.name}.`,
      )
    }
    participantsByName.set(key, participant)
  }

  const categoryIdsByName = new Map(
    categories.map((category) => [
      normalizeCategoryName(category.name),
      category.id,
    ]),
  )
  const skipped = emptySkippedReasons()
  const expenses: PreparedSplitwiseExpense[] = []

  for (const row of rows) {
    if (row.title.trim().toLowerCase() === 'total balance') continue

    const sourceCurrency = row.currency.trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(sourceCurrency)) {
      throw new SplitwiseCsvError(
        `Row ${row.rowNumber}: currency must be a three-letter ISO code.`,
      )
    }

    const originalAmount = parseMinorUnits(
      row.cost,
      sourceCurrency,
      row.rowNumber,
      'cost',
    )
    if (originalAmount <= 0 || !row.title.trim()) {
      skipped.invalidExpense += 1
      continue
    }

    const participantBalances = row.participantBalances.map(
      ({ name, amount }) => {
        const participant = participantsByName.get(
          normalizeParticipantName(name),
        )
        if (!participant) {
          throw new SplitwiseCsvError(
            `Row ${row.rowNumber}: participant “${name}” is not in this Spliit group.`,
          )
        }
        return {
          participant,
          amount: parseMinorUnits(amount, sourceCurrency, row.rowNumber, name),
        }
      },
    )

    const creditors = participantBalances.filter(({ amount }) => amount > 0)
    const debtors = participantBalances.filter(({ amount }) => amount < 0)

    if (creditors.length === 0 && debtors.length === 0) {
      // Splitwise no longer provides enough information to recreate settled rows.
      skipped.settled += 1
      continue
    }
    if (creditors.length !== 1) {
      // Spliit currently models one payer per expense.
      skipped.multiplePayers += 1
      continue
    }

    const payer = creditors[0]
    const totalDebts = debtors.reduce(
      (total, debtor) => total - debtor.amount,
      0,
    )
    const netDifference = payer.amount - totalDebts
    const payerShare = originalAmount - totalDebts

    // Splitwise rounds cells to the currency precision. Permit a one-minor-unit
    // display rounding difference, but do not manufacture a different balance.
    if (Math.abs(netDifference) > 1 || payerShare < 0) {
      skipped.invalidExpense += 1
      continue
    }

    const sourcePaidFor = debtors.map(({ participant, amount }) => ({
      participantId: participant.id,
      shares: -amount,
    }))
    if (payerShare > 0) {
      sourcePaidFor.push({
        participantId: payer.participant.id,
        shares: payerShare,
      })
    }

    if (sourcePaidFor.length === 0) {
      skipped.invalidExpense += 1
      continue
    }

    const conversionRequired = sourceCurrency !== groupCurrency
    let conversionRate: number | undefined
    if (conversionRequired) {
      try {
        conversionRate = await getCurrencyRate(sourceCurrency, groupCurrency)
      } catch {
        throw new SplitwiseCsvError(
          `Could not get the current ${sourceCurrency} to ${groupCurrency} exchange rate. Try importing again later.`,
        )
      }
      if (!Number.isFinite(conversionRate) || conversionRate <= 0) {
        throw new SplitwiseCsvError(
          `Could not get a valid current ${sourceCurrency} to ${groupCurrency} exchange rate.`,
        )
      }
    }

    const amount = conversionRequired
      ? convertMinorUnits(
          originalAmount,
          sourceCurrency,
          groupCurrency,
          conversionRate!,
        )
      : originalAmount
    if (amount <= 0) {
      skipped.invalidExpense += 1
      continue
    }
    const paidFor = conversionRequired
      ? convertPaidFor(
          sourcePaidFor,
          amount,
          sourceCurrency,
          groupCurrency,
          conversionRate!,
        )
      : sourcePaidFor

    if (paidFor.some(({ shares }) => shares <= 0)) {
      skipped.invalidExpense += 1
      continue
    }

    expenses.push({
      expenseDate: parseDate(row.date, row.rowNumber),
      title: row.title.trim(),
      categoryId: categoryIdFor(row.category, categoryIdsByName),
      amount,
      ...(conversionRequired
        ? { originalAmount, originalCurrency: sourceCurrency, conversionRate }
        : {}),
      paidById: payer.participant.id,
      paidFor,
    })
  }

  return { expenses, skipped }
}

function parseSplitwiseCsv(csv: string): ParsedSplitwiseRow[] {
  const records = parseCsv(csv)
  const header = records.shift()
  if (!header) throw new SplitwiseCsvError('The CSV file is empty.')

  const normalizedHeader = header.map((value) =>
    value.replace(/^\uFEFF/, '').trim(),
  )
  const missingColumns = REQUIRED_COLUMNS.filter(
    (column, index) =>
      normalizedHeader[index]?.toLowerCase() !== column.toLowerCase(),
  )
  if (missingColumns.length > 0) {
    throw new SplitwiseCsvError(
      'This does not look like a standard Splitwise CSV export. Expected Date, Description, Category, Cost, and Currency columns.',
    )
  }

  const participantNames = normalizedHeader.slice(REQUIRED_COLUMNS.length)
  if (!participantNames.length || participantNames.some((name) => !name)) {
    throw new SplitwiseCsvError(
      'The Splitwise CSV must include at least one named participant column.',
    )
  }
  if (
    new Set(participantNames.map(normalizeParticipantName)).size !==
    participantNames.length
  ) {
    throw new SplitwiseCsvError(
      'The Splitwise CSV has duplicate participant columns.',
    )
  }

  return records
    .map((record, index) => ({ record, rowNumber: index + 2 }))
    .filter(({ record }) => record.some((value) => value.trim()))
    .map(({ record, rowNumber }) => {
      if (record.length < normalizedHeader.length) {
        throw new SplitwiseCsvError(
          `Row ${rowNumber}: expected ${normalizedHeader.length} columns.`,
        )
      }
      return {
        rowNumber,
        date: record[0],
        title: record[1],
        category: record[2],
        cost: record[3],
        currency: record[4],
        participantBalances: participantNames.map((name, index) => ({
          name,
          amount: record[index + REQUIRED_COLUMNS.length] ?? '',
        })),
      }
    })
}

function parseCsv(csv: string): string[][] {
  const records: string[][] = []
  let record: string[] = []
  let value = ''
  let quoted = false

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index]

    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') {
        value += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        value += character
      }
      continue
    }

    if (character === '"' && value.length === 0) {
      quoted = true
    } else if (character === ',') {
      record.push(value)
      value = ''
    } else if (character === '\n') {
      record.push(value)
      records.push(record)
      record = []
      value = ''
    } else if (character !== '\r') {
      value += character
    }
  }

  if (quoted)
    throw new SplitwiseCsvError('The CSV file has an unclosed quoted value.')
  if (value.length > 0 || record.length > 0) {
    record.push(value)
    records.push(record)
  }

  return records
}

function parseDate(value: string, rowNumber: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    throw new SplitwiseCsvError(`Row ${rowNumber}: date must be YYYY-MM-DD.`)
  }
  const [year, month, day] = value.trim().split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day, 12))
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new SplitwiseCsvError(`Row ${rowNumber}: date is invalid.`)
  }
  return date
}

function parseMinorUnits(
  input: string,
  currencyCode: string,
  rowNumber: number,
  column: string,
) {
  const decimalDigits = currencyDecimalDigits(currencyCode)
  const value = input.trim().replace(',', '.')
  const match = value.match(/^(-?)(\d+)(?:\.(\d+))?$/)
  if (!match) {
    throw new SplitwiseCsvError(
      `Row ${rowNumber}: ${column} must be a valid ${currencyCode} amount.`,
    )
  }

  const [, sign, whole, fraction = ''] = match
  const extraFraction = fraction.slice(decimalDigits)
  if (extraFraction && /[1-9]/.test(extraFraction)) {
    throw new SplitwiseCsvError(
      `Row ${rowNumber}: ${column} has too many decimal places for ${currencyCode}.`,
    )
  }

  const minorUnits =
    Number(whole) * 10 ** decimalDigits +
    Number(fraction.slice(0, decimalDigits).padEnd(decimalDigits, '0'))
  if (!Number.isSafeInteger(minorUnits)) {
    throw new SplitwiseCsvError(`Row ${rowNumber}: ${column} is too large.`)
  }
  return sign === '-' ? -minorUnits : minorUnits
}

function convertPaidFor(
  paidFor: { participantId: string; shares: number }[],
  convertedAmount: number,
  sourceCurrency: string,
  targetCurrency: string,
  conversionRate: number,
) {
  let remainingAmount = convertedAmount
  return paidFor.map(({ participantId, shares }, index) => {
    const convertedShares =
      index === paidFor.length - 1
        ? remainingAmount
        : convertMinorUnits(
            shares,
            sourceCurrency,
            targetCurrency,
            conversionRate,
          )
    remainingAmount -= convertedShares
    return { participantId, shares: convertedShares }
  })
}

function convertMinorUnits(
  amount: number,
  sourceCurrency: string,
  targetCurrency: string,
  conversionRate: number,
) {
  const convertedAmount =
    (amount / 10 ** currencyDecimalDigits(sourceCurrency)) *
    conversionRate *
    10 ** currencyDecimalDigits(targetCurrency)
  if (!Number.isSafeInteger(Math.round(convertedAmount))) {
    throw new SplitwiseCsvError('The converted amount is too large.')
  }
  return Math.round(convertedAmount)
}

function currencyDecimalDigits(currencyCode: string) {
  return currencyCode === 'JPY' || currencyCode === 'KRW' ? 0 : 2
}

function categoryIdFor(category: string, categories: Map<string, number>) {
  const normalized = normalizeCategoryName(category)
  const aliases: Record<string, string> = {
    grocery: 'groceries',
  }
  return categories.get(aliases[normalized] ?? normalized) ?? 0
}

function normalizeParticipantName(value: string) {
  return normalizeString(value).replace(/\s+/g, ' ').trim()
}

function normalizeCategoryName(value: string) {
  return normalizeString(value).replace(/[^a-z0-9]/g, '')
}

function emptySkippedReasons(): Record<SplitwiseImportSkipReason, number> {
  return {
    settled: 0,
    multiplePayers: 0,
    invalidExpense: 0,
  }
}
