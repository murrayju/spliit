'use client'

import { ActiveUserModal } from '@/app/groups/[groupId]/expenses/active-user-modal'
import { CreateFromReceiptButton } from '@/app/groups/[groupId]/expenses/create-from-receipt-button'
import { ExpenseList } from '@/app/groups/[groupId]/expenses/expense-list'
import ExportButton from '@/app/groups/[groupId]/export-button'
import { SplitwiseImportButton } from '@/app/groups/[groupId]/splitwise-import-button'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Plus } from 'lucide-react'
import { Metadata } from 'next'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useCurrentGroup } from '../current-group-context'

export const revalidate = 3600

export const metadata: Metadata = {
  title: 'Expenses',
}

export default function GroupExpensesPageClient({
  enableReceiptExtract,
}: {
  enableReceiptExtract: boolean
}) {
  const t = useTranslations('Expenses')
  const { groupId } = useCurrentGroup()

  return (
    <>
      <Card className="mb-4 rounded-none -mx-4 border-x-0 sm:border-x sm:rounded-lg sm:mx-0">
        <div className="flex flex-1">
          <CardHeader className="flex-1 p-4 sm:p-6">
            <CardTitle>{t('title')}</CardTitle>
            <CardDescription>{t('description')}</CardDescription>
          </CardHeader>
          <CardHeader className="flex flex-row space-y-0 p-4 sm:p-6">
            <ExportButton groupId={groupId} />
          </CardHeader>
        </div>

        <CardContent className="relative flex flex-col gap-4 p-0 pb-24 pt-2 sm:pb-28">
          <ExpenseList />
        </CardContent>
      </Card>

      <div className="fixed bottom-4 right-4 z-40 flex flex-col-reverse items-end gap-3 pb-[env(safe-area-inset-bottom)] [&_button]:rounded-full [&_button]:shadow-lg sm:bottom-6 sm:right-6">
        <Button
          asChild
          size="icon"
          className="h-14 w-14 rounded-full shadow-lg"
        >
          <Link href={`/groups/${groupId}/expenses/create`} title={t('create')}>
            <Plus className="h-6 w-6" />
            <span className="sr-only">{t('create')}</span>
          </Link>
        </Button>
        {enableReceiptExtract && <CreateFromReceiptButton />}
        <SplitwiseImportButton />
      </div>

      <ActiveUserModal groupId={groupId} />
    </>
  )
}
