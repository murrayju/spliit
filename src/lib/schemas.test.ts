import { expenseFormSchema } from './schemas'

const entry = (overrides: Record<string, unknown> = {}) => ({
  expenseDate: new Date('2026-07-21'),
  title: 'Test entry',
  category: 0,
  amount: 10,
  originalCurrency: '',
  paidBy: 'alice',
  paidFor: [{ participant: 'bob', shares: '1' }],
  splitMode: 'EVENLY',
  saveDefaultSplittingOptions: false,
  isReimbursement: false,
  documents: [],
  notes: '',
  recurrenceRule: 'NONE',
  ...overrides,
})

describe('expense form entry validation', () => {
  it('accepts a repayment between two different participants', () => {
    expect(
      expenseFormSchema.safeParse(entry({ isReimbursement: true })).success,
    ).toBe(true)
  })

  it('rejects a repayment to the sender', () => {
    const result = expenseFormSchema.safeParse(
      entry({
        isReimbursement: true,
        paidFor: [{ participant: 'alice', shares: '1' }],
      }),
    )

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        'repaymentDifferentParticipants',
      )
    }
  })

  it('accepts positive by-amount magnitudes used by refund forms', () => {
    expect(
      expenseFormSchema.safeParse(
        entry({
          amount: 10,
          splitMode: 'BY_AMOUNT',
          paidFor: [
            { participant: 'alice', shares: '6' },
            { participant: 'bob', shares: '4' },
          ],
        }),
      ).success,
    ).toBe(true)
  })
})
