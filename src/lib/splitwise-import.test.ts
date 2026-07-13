import { prepareSplitwiseImport } from './splitwise-import'

const group = {
  currencyCode: 'USD',
  participants: [
    { id: 'jess', name: 'Jess' },
    { id: 'justin', name: 'Justin Murray' },
    { id: 'lisa', name: 'Lisa Storey' },
  ],
}

const categories = [
  { id: 0, name: 'General' },
  { id: 8, name: 'Dining Out' },
  { id: 9, name: 'Groceries' },
]

describe('prepareSplitwiseImport', () => {
  it('recreates one-payer Splitwise balances with an amount split', async () => {
    const { expenses, skipped } = await prepareSplitwiseImport(
      `Date,Description,Category,Cost,Currency,Jess,Justin Murray,Lisa Storey
2026-07-11,"Dinner, Oslo",Dining out,98.22,USD,-32.74,65.48,-32.74
2026-07-12,Airport lunch,Groceries,61.00,USD,30.50,-30.50,0.00
2026-07-12,Total balance, , ,USD,2200.04,-448.17,-1751.87
2026-07-07,Settled dinner,Dining out,868.00,USD,0.00,0.00,0.00`,
      group,
      categories,
      async () => 1,
    )

    expect(expenses).toEqual([
      {
        expenseDate: new Date('2026-07-11T12:00:00.000Z'),
        title: 'Dinner, Oslo',
        categoryId: 8,
        amount: 9822,
        paidById: 'justin',
        paidFor: [
          { participantId: 'jess', shares: 3274 },
          { participantId: 'lisa', shares: 3274 },
          { participantId: 'justin', shares: 3274 },
        ],
      },
      {
        expenseDate: new Date('2026-07-12T12:00:00.000Z'),
        title: 'Airport lunch',
        categoryId: 9,
        amount: 6100,
        paidById: 'jess',
        paidFor: [
          { participantId: 'justin', shares: 3050 },
          { participantId: 'jess', shares: 3050 },
        ],
      },
    ])
    expect(skipped).toEqual({
      settled: 1,
      multiplePayers: 0,
      invalidExpense: 0,
    })
  })

  it('converts foreign-currency rows and skips only unsupported payer splits', async () => {
    const { expenses, skipped } = await prepareSplitwiseImport(
      `Date,Description,Category,Cost,Currency,Jess,Justin Murray,Lisa Storey
2026-07-11,Foreign,General,100.00,NOK,100.00,-50.00,-50.00
2026-07-11,Multiple payers,General,100.00,USD,25.00,25.00,-50.00`,
      group,
      categories,
      async () => 0.1,
    )

    expect(expenses).toEqual([
      {
        expenseDate: new Date('2026-07-11T12:00:00.000Z'),
        title: 'Foreign',
        categoryId: 0,
        amount: 1000,
        originalAmount: 10000,
        originalCurrency: 'NOK',
        conversionRate: 0.1,
        paidById: 'jess',
        paidFor: [
          { participantId: 'justin', shares: 500 },
          { participantId: 'lisa', shares: 500 },
        ],
      },
    ])
    expect(skipped).toEqual({
      settled: 0,
      multiplePayers: 1,
      invalidExpense: 0,
    })
  })
})
