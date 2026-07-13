import { createSplitwiseExpenses, getCategories, getGroup } from '@/lib/api'
import {
  SplitwiseCsvError,
  prepareSplitwiseImport,
} from '@/lib/splitwise-import'
import { baseProcedure } from '@/trpc/init'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'

const MAX_CSV_SIZE = 5 * 1024 * 1024
const MAX_EXPENSES_PER_IMPORT = 1_000

async function fetchCurrentCurrencyRate(
  baseCurrency: string,
  targetCurrency: string,
) {
  const params = new URLSearchParams({
    base: baseCurrency,
    symbols: targetCurrency,
  })
  const response = await fetch(
    `https://api.frankfurter.app/latest?${params.toString()}`,
    { signal: AbortSignal.timeout(10_000) },
  )
  if (!response.ok) throw new Error('Exchange-rate service request failed.')

  const data = (await response.json()) as {
    rates?: Record<string, unknown>
  }
  const rate = data.rates?.[targetCurrency]
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
    throw new Error('Exchange-rate service did not return a valid rate.')
  }
  return rate
}

export const importSplitwiseCsvProcedure = baseProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      csv: z.string().min(1).max(MAX_CSV_SIZE),
    }),
  )
  .mutation(async ({ input: { groupId, csv } }) => {
    const group = await getGroup(groupId)
    if (!group) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Invalid group ID.' })
    }

    try {
      const currentRates = new Map<string, Promise<number>>()
      const getCurrentCurrencyRate = (
        baseCurrency: string,
        targetCurrency: string,
      ) => {
        const key = `${baseCurrency}:${targetCurrency}`
        let rate = currentRates.get(key)
        if (!rate) {
          rate = fetchCurrentCurrencyRate(baseCurrency, targetCurrency)
          currentRates.set(key, rate)
        }
        return rate
      }
      const { expenses, skipped } = await prepareSplitwiseImport(
        csv,
        group,
        await getCategories(),
        getCurrentCurrencyRate,
      )
      if (expenses.length > MAX_EXPENSES_PER_IMPORT) {
        throw new SplitwiseCsvError(
          `A single import is limited to ${MAX_EXPENSES_PER_IMPORT} expenses.`,
        )
      }

      await createSplitwiseExpenses(groupId, expenses)
      return {
        imported: expenses.length,
        skipped: Object.values(skipped).reduce(
          (total, count) => total + count,
          0,
        ),
      }
    } catch (error) {
      if (error instanceof SplitwiseCsvError) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: error.message })
      }
      throw error
    }
  })
