'use client'

import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useActiveUser } from '@/lib/hooks'
import { cn, formatCurrency, getCurrencyFromGroup } from '@/lib/utils'
import { trpc } from '@/trpc/client'
import { useLocale, useTranslations } from 'next-intl'
import { useCurrentGroup } from '../current-group-context'

export function ParticipantStatsTable() {
  const { groupId, group } = useCurrentGroup()
  const activeUser = useActiveUser(groupId)
  const participantId =
    activeUser && activeUser !== 'None' ? activeUser : undefined
  const { data } = trpc.groups.stats.get.useQuery({ groupId, participantId })
  const locale = useLocale()
  const t = useTranslations('Stats.ParticipantTable')

  if (!data || !group) {
    return <ParticipantStatsTableLoading rows={group?.participants.length} />
  }

  const currency = getCurrencyFromGroup(group)
  const money = (amount: number) => formatCurrency(currency, amount, locale)

  return (
    <div className="rounded-md border">
      <Table aria-label={t('title')} className="min-w-[640px]">
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 z-20 min-w-32 bg-card px-3">
              {t('person')}
            </TableHead>
            <TableHead className="whitespace-nowrap px-3 text-right">
              {t('spending')}
            </TableHead>
            <TableHead className="whitespace-nowrap px-3 text-right">
              {t('share')}
            </TableHead>
            <TableHead className="whitespace-nowrap px-3 text-right">
              {t('repayments')}
            </TableHead>
            <TableHead className="whitespace-nowrap px-3 text-right">
              {t('balance')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.participantStats.map((participant) => (
            <TableRow key={participant.id} className="group">
              <TableCell className="sticky left-0 z-10 bg-card px-3 font-medium group-hover:bg-muted">
                {participant.name}
              </TableCell>
              <TableCell className="whitespace-nowrap px-3 text-right tabular-nums">
                {money(participant.totalSpending)}
              </TableCell>
              <TableCell className="whitespace-nowrap px-3 text-right tabular-nums">
                {money(participant.totalShare)}
              </TableCell>
              <TableCell className="whitespace-nowrap px-3 text-right tabular-nums">
                {money(participant.repayments)}
              </TableCell>
              <TableCell
                className={cn(
                  'whitespace-nowrap px-3 text-right font-medium tabular-nums',
                  participant.balance > 0 &&
                    'text-green-600 dark:text-green-400',
                  participant.balance < 0 && 'text-red-600 dark:text-red-400',
                )}
              >
                {money(participant.balance)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function ParticipantStatsTableLoading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      {Array.from({ length: Math.max(rows, 1) }).map((_, index) => (
        <div
          key={index}
          className="flex items-center justify-between gap-6 py-2"
        >
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-52" />
        </div>
      ))}
    </div>
  )
}
