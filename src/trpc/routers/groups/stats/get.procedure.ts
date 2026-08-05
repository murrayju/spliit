import { getGroup, getGroupExpenses } from '@/lib/api'
import { getBalances } from '@/lib/balances'
import {
  getTotalActiveUserPaidFor,
  getTotalActiveUserShare,
  getTotalGroupSpending,
  getTotalParticipantRepayments,
} from '@/lib/totals'
import { baseProcedure } from '@/trpc/init'
import { z } from 'zod'

export const getGroupStatsProcedure = baseProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      participantId: z.string().optional(),
    }),
  )
  .query(async ({ input: { groupId, participantId } }) => {
    const [expenses, group] = await Promise.all([
      getGroupExpenses(groupId),
      getGroup(groupId),
    ])
    const totalGroupSpendings = getTotalGroupSpending(expenses)

    const totalParticipantSpendings =
      participantId !== undefined
        ? getTotalActiveUserPaidFor(participantId, expenses)
        : undefined
    const totalParticipantShare =
      participantId !== undefined
        ? getTotalActiveUserShare(participantId, expenses)
        : undefined

    const balances = getBalances(expenses)
    const participantStats =
      group?.participants.map((participant) => ({
        id: participant.id,
        name: participant.name,
        totalSpending: getTotalActiveUserPaidFor(participant.id, expenses),
        totalShare: getTotalActiveUserShare(participant.id, expenses),
        repayments: getTotalParticipantRepayments(participant.id, expenses),
        balance: balances[participant.id]?.total ?? 0,
      })) ?? []

    return {
      totalGroupSpendings,
      totalParticipantSpendings,
      totalParticipantShare,
      participantStats,
    }
  })
