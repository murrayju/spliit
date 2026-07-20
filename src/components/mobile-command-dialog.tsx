'use client'

import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { ReactNode, useRef } from 'react'

export function MobileCommandDialog({
  open,
  onOpenChange,
  title,
  trigger,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  trigger: ReactNode
  children: ReactNode
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/80" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex h-[100dvh] w-full flex-col overflow-hidden bg-background pt-[env(safe-area-inset-top)] outline-none"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            closeButtonRef.current?.focus({ preventScroll: true })
          }}
        >
          <DialogPrimitive.Title className="sr-only">
            {title}
          </DialogPrimitive.Title>
          {children}
          <DialogPrimitive.Close
            ref={closeButtonRef}
            className="absolute right-3 top-[calc(env(safe-area-inset-top)+0.625rem)] rounded-md p-2 text-muted-foreground outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <X className="h-5 w-5" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
