import {
  amountForEntryForm,
  amountForEntryStorage,
  inferExpenseEntryType,
} from './expense-entry'

describe('expense entry types', () => {
  it('infers expenses, refunds, and repayments from existing records', () => {
    expect(inferExpenseEntryType({ amount: 100, isReimbursement: false })).toBe(
      'EXPENSE',
    )
    expect(
      inferExpenseEntryType({ amount: -100, isReimbursement: false }),
    ).toBe('REFUND')
    expect(inferExpenseEntryType({ amount: 100, isReimbursement: true })).toBe(
      'REPAYMENT',
    )
  })

  it('uses positive amounts in the form and signs refunds for storage', () => {
    expect(amountForEntryForm(-12.34)).toBe(12.34)
    expect(amountForEntryStorage(12.34, 'EXPENSE')).toBe(12.34)
    expect(amountForEntryStorage(12.34, 'REFUND')).toBe(-12.34)
    expect(amountForEntryStorage(-12.34, 'REPAYMENT')).toBe(12.34)
  })
})
