import { calculateShare, getTotalGroupSpending } from './totals'

describe('calculateShare', () => {
  it('returns negative by-amount shares for refunds', () => {
    expect(
      calculateShare('alice', {
        amount: -1000,
        splitMode: 'BY_AMOUNT',
        isReimbursement: false,
        paidFor: [
          {
            participant: { id: 'alice' },
            shares: 600,
          },
          {
            participant: { id: 'bob' },
            shares: 400,
          },
        ],
      } as any),
    ).toBe(-600)
  })

  it('subtracts refunds and excludes repayments from group spending', () => {
    expect(
      getTotalGroupSpending([
        { amount: 5000, isReimbursement: false },
        { amount: -1200, isReimbursement: false },
        { amount: 800, isReimbursement: true },
      ] as any),
    ).toBe(3800)
  })
})
