import { ParticipantStatsTable } from '@/app/groups/[groupId]/stats/participant-stats-table'
import { Totals } from '@/app/groups/[groupId]/stats/totals'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useTranslations } from 'next-intl'

export function TotalsPageClient() {
  const t = useTranslations('Stats')

  return (
    <>
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{t('Totals.title')}</CardTitle>
          <CardDescription>{t('Totals.description')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col space-y-4">
          <Totals />
        </CardContent>
      </Card>
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{t('ParticipantTable.title')}</CardTitle>
          <CardDescription>{t('ParticipantTable.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ParticipantStatsTable />
        </CardContent>
      </Card>
    </>
  )
}
