export const expenseEntryTypes = ['EXPENSE', 'REFUND', 'REPAYMENT'] as const

export type ExpenseEntryType = (typeof expenseEntryTypes)[number]

export function inferExpenseEntryType({
  amount,
  isReimbursement,
}: {
  amount: number
  isReimbursement: boolean
}): ExpenseEntryType {
  if (isReimbursement) return 'REPAYMENT'
  return amount < 0 ? 'REFUND' : 'EXPENSE'
}

export function amountForEntryForm(amount: number): number {
  return Math.abs(amount)
}

export function amountForEntryStorage(
  amount: number,
  entryType: ExpenseEntryType,
): number {
  const absoluteAmount = Math.abs(amount)
  return entryType === 'REFUND' ? -absoluteAmount : absoluteAmount
}
