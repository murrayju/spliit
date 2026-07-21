import { getBalances } from './balances'

const participant = (id: string) => ({ id, name: id })
const paidFor = (id: string) => ({
  participant: participant(id),
  shares: 100,
})

describe('refund and repayment balances', () => {
  it('cancels an expense with an equivalent refund', () => {
    const balances = getBalances([
      {
        amount: 1000,
        paidBy: participant('alice'),
        paidFor: [paidFor('alice'), paidFor('bob')],
        splitMode: 'EVENLY',
      },
      {
        amount: -1000,
        paidBy: participant('alice'),
        paidFor: [paidFor('alice'), paidFor('bob')],
        splitMode: 'EVENLY',
      },
    ] as any)

    expect(balances.alice.total).toBe(0)
    expect(balances.bob.total).toBe(0)
  })

  it('settles a debt with a repayment from the debtor to the creditor', () => {
    const balances = getBalances([
      {
        amount: 1000,
        paidBy: participant('bob'),
        paidFor: [paidFor('alice')],
        splitMode: 'EVENLY',
      },
      {
        amount: 1000,
        paidBy: participant('alice'),
        paidFor: [paidFor('bob')],
        splitMode: 'EVENLY',
        isReimbursement: true,
      },
    ] as any)

    expect(balances.alice.total).toBe(0)
    expect(balances.bob.total).toBe(0)
  })
})
