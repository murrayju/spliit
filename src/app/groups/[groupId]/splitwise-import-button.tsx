'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/use-toast'
import { trpc } from '@/trpc/client'
import { FileUp, Loader2, Upload } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useCurrentGroup } from './current-group-context'

const MAX_CSV_SIZE = 5 * 1024 * 1024

export function SplitwiseImportButton() {
  const t = useTranslations('Expenses.Import')
  const { groupId, group } = useCurrentGroup()
  const { toast } = useToast()
  const router = useRouter()
  const utils = trpc.useUtils()
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const { mutateAsync: importSplitwiseCsv, isPending } =
    trpc.groups.expenses.importSplitwiseCsv.useMutation()

  const close = () => {
    setOpen(false)
    setFile(null)
    setFileError(null)
  }

  const selectFile = (selectedFile?: File) => {
    if (!selectedFile) return
    if (selectedFile.size > MAX_CSV_SIZE) {
      setFile(null)
      setFileError(t('fileTooLarge'))
      return
    }
    setFile(selectedFile)
    setFileError(null)
  }

  const importFile = async () => {
    if (!file) return

    try {
      const result = await importSplitwiseCsv({
        groupId,
        csv: await file.text(),
      })
      await utils.groups.expenses.invalidate()
      router.refresh()
      toast({
        title:
          result.imported > 0
            ? t('successTitle', { count: result.imported })
            : t('nothingImported'),
        description:
          result.skipped > 0
            ? t('successWithSkipped', {
                imported: result.imported,
                skipped: result.skipped,
              })
            : undefined,
      })
      close()
    } catch (error) {
      toast({
        title: t('errorTitle'),
        description: error instanceof Error ? error.message : t('error'),
        variant: 'destructive',
      })
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => (nextOpen ? setOpen(true) : close())}
    >
      <DialogTrigger asChild>
        <Button
          size="icon"
          variant="secondary"
          title={t('triggerTitle')}
          aria-label={t('triggerTitle')}
        >
          <Upload className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <Input
            type="file"
            accept=".csv,text/csv"
            aria-label={t('fileLabel')}
            onChange={(event) => selectFile(event.target.files?.[0])}
            disabled={isPending}
          />
          {file && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <FileUp className="h-4 w-4" />
              {t('selectedFile', { fileName: file.name })}
            </p>
          )}
          {fileError && <p className="text-destructive">{fileError}</p>}
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>{t('participantsNote')}</li>
            <li>
              {group?.currencyCode
                ? t('currencyNote', { currency: group.currencyCode })
                : t('currencyRequired')}
            </li>
            <li>{t('unsupportedRowsNote')}</li>
          </ul>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={close}
            disabled={isPending}
          >
            {t('cancel')}
          </Button>
          <Button
            type="button"
            onClick={importFile}
            disabled={!file || !!fileError || isPending || !group?.currencyCode}
          >
            {isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            {isPending ? t('importing') : t('import')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
