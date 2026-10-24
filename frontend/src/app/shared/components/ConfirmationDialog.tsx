"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { AlertTriangle, FileText } from "lucide-react"
import { Button } from "@/app/shared/components/ui/button"
import {
  Dialog as DialogPrimitive,
  DialogContent,
  DialogDescription,
  DialogFooter,
} from "@/app/shared/components/ui/dialog"
import { useI18n } from "@/lib/i18n/I18nContext"

type ConfirmationDialogVariant = "cancel-verification" | "new-text"

interface ConfirmationDialogProps {
  isOpen?: boolean
  onClose?: () => void
  onCancel?: () => void
  onConfirm?: () => void
  variant?: ConfirmationDialogVariant
  description?: string
  confirmText?: string
  cancelText?: string
  className?: string
}

const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  isOpen = false,
  onClose,
  onCancel,
  onConfirm,
  variant = "cancel-verification",
  description,
  confirmText,
  cancelText,
  className,
}) => {
  const { t } = useI18n();

  // Configurações específicas para cada variant
  const getVariantConfig = (variant: ConfirmationDialogVariant) => {
    switch (variant) {
      case "new-text":
        return {
          icon: FileText,
          iconColor: "text-[var(--purple-hover)]",
          bgColor: "bg-[var(--bg-purple-light)]",
          defaultDescription: t.confirmationDialog.newText.description,
          defaultConfirmText: t.confirmationDialog.newText.confirm,
          defaultCancelText: t.confirmationDialog.newText.cancel,
        }
      case "cancel-verification":
      default:
        return {
          icon: AlertTriangle,
          iconColor: "text-[var(--purple-hover)]",
          bgColor: "bg-[var(--bg-purple-light)]",
          defaultDescription: t.confirmationDialog.cancelVerification.description,
          defaultConfirmText: t.confirmationDialog.cancelVerification.confirm,
          defaultCancelText: t.confirmationDialog.cancelVerification.cancel,
        }
    }
  }

  const config = getVariantConfig(variant)
  const IconComponent = config.icon

  // Lida com confirmação. A navegação deve ser feita pelo chamador.
  const handleConfirm = () => {
    onConfirm?.()
  }

  return (
    <DialogPrimitive
      open={isOpen}
      // Garante chamar onClose apenas quando o Dialog fechar
      onOpenChange={(open) => {
        if (!open) onClose?.()
      }}
    >
      <DialogContent
        className={cn(
          "w-[calc(100%-2rem)] max-w-[516px] bg-neutral-50 rounded-2xl px-6 sm:px-10 py-6 sm:py-8 gap-4",
          "shadow-[0px_4px_8px_0px_rgba(0,0,0,0.15),var(--shadow-card)]",
          "outline outline-1 outline-offset-[-1px] outline-[var(--purple-primary)]",
          className
        )}
        showCloseButton={false}
      >
        <div className="flex flex-col gap-4 sm:gap-6 items-center justify-start w-full">
          {/* Icon Section */}
          <div className={cn("flex items-center justify-center p-4 sm:p-6 rounded-2xl", config.bgColor)}>
            <div className={cn("flex items-center justify-center", config.iconColor)}>
              <IconComponent className="size-12" />
            </div>
          </div>

          {/* Message Section */}
          <div className="w-full text-center">
            <DialogDescription className="text-[var(--text-active)] text-base leading-6 tracking-[0.16px] font-[var(--font-inter)] font-normal">
              {description || config.defaultDescription}
            </DialogDescription>
          </div>
        </div>

        {/* Actions Section */}
        <DialogFooter className="flex items-center w-full gap-2">
          <div className="flex w-full items-center">
            <Button
              variant="link"
              size="sm"
              onClick={() => {
                console.log('🔘 Botão Cancelar clicado');
                if (onCancel) {
                  console.log('📞 Chamando onCancel');
                  onCancel();
                } else if (onClose) {
                  console.log('📞 Chamando onClose (fallback)');
                  onClose();
                }
              }}
              className="ml-0"
            >
              {cancelText || config.defaultCancelText}
            </Button>
            <div className="flex-1" />
            <Button
              variant="outlined"
              size="sm"
              onClick={() => {
                console.log('🔘 Botão Confirmar clicado');
                handleConfirm();
              }}
              className="mr-0"
            >
              {confirmText || config.defaultConfirmText}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </DialogPrimitive>
  )
}

export { ConfirmationDialog }
export type { ConfirmationDialogProps }
