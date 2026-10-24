"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/app/shared/components/ui/button"
import { X, RotateCcw, Copy, CircleCheck, AlertCircle, Check, Sparkles } from "lucide-react"
import AnimatedDots from "@/app/shared/components/AnimatedDots"
import ResultsSectionTitle from "./ResultsSectionTitle"
import { useI18n } from "@/lib/i18n/I18nContext"

type VerificationStatus = "verifying" | "error" | "done" | "complete-no-results"

interface ResultsHeaderProps {
  status: VerificationStatus
  onCancel?: () => void
  onRetry?: () => void
  onCopy?: () => void
  className?: string
  disabled?: boolean
}

interface StatusConfig {
  text: string
  textColor: string
  icon: React.ReactNode
  buttonText?: string
  buttonIcon?: React.ReactNode
  onButtonClick?: () => void
  useAnimatedDots?: boolean
  showButton?: boolean
}

const ResultsHeader: React.FC<ResultsHeaderProps> = ({
  status,
  onCancel,
  onRetry,
  onCopy,
  className,
  disabled = false,
}) => {
  const { t } = useI18n();
  const [isCopied, setIsCopied] = React.useState(false)

  const handleCopy = () => {
    if (onCopy) {
      onCopy()
      setIsCopied(true)
      setTimeout(() => {
        setIsCopied(false)
      }, 2500)
    }
  }

  const getStatusConfig = (): StatusConfig => {
    switch (status) {
      case "verifying":
        return {
          text: t.results.status.verifying,
          textColor: "text-slate-900",
          icon: (
            <div className="relative shrink-0 size-[24px]">
              <div className="absolute bg-[#77e6a0] left-1/2 rounded-[9999px] size-[24px] top-1/2 translate-x-[-50%] translate-y-[-50%]"
                   style={{
                     animation: 'fadePulse 1.5s ease-in-out infinite'
                   }} />
              <div className="absolute bg-green-500 left-1/2 rounded-[9999px] size-[12px] top-1/2 translate-x-[-50%] translate-y-[-50%]" />
            </div>
          ),
          buttonText: t.results.actions.cancel,
          buttonIcon: <X className="size-4" />,
          onButtonClick: onCancel,
          useAnimatedDots: true,
          showButton: true,
        }

      case "error":
        return {
          text: t.results.status.error,
          textColor: "text-[#cb1f1f]",
          icon: (
            <div className="box-border content-stretch flex gap-2 items-center justify-center p-[8px] relative rounded-[100px] shrink-0 size-[24px]">
              <div className="overflow-clip relative shrink-0 size-[24px]">
                <AlertCircle className="size-[24px] text-[#cb1f1f]" />
              </div>
            </div>
          ),
          buttonText: t.results.actions.retry,
          buttonIcon: <RotateCcw className="size-4" />,
          onButtonClick: onRetry,
          showButton: true,
        }

      case "done":
        return {
          text: t.results.status.complete,
          textColor: "text-slate-900",
          icon: (
            <div className="box-border content-stretch flex gap-2 items-center justify-center p-[8px] relative rounded-[100px] shrink-0 size-[24px]">
              <div className="overflow-clip relative shrink-0 size-[24px]">
                <CircleCheck className="size-[24px] text-green-500" />
              </div>
            </div>
          ),
          buttonText: isCopied ? t.results.actions.copied : t.results.actions.copyAsText,
          buttonIcon: isCopied ? <Check className="size-4 text-green-500" /> : <Copy className="size-4" />,
          onButtonClick: handleCopy,
          showButton: true,
        }

      case "complete-no-results":
        return {
          text: t.results.status.complete,
          textColor: "text-slate-900",
          icon: (
            <div className="box-border content-stretch flex gap-2 items-center justify-center p-[8px] relative rounded-[100px] shrink-0 size-[24px]">
              <div className="overflow-clip relative shrink-0 size-[24px]">
                <CircleCheck className="size-[24px] text-green-500" />
              </div>
            </div>
          ),
          showButton: false,
        }

      default:
        return {
          text: t.results.status.verifying,
          textColor: "text-slate-900",
          icon: null,
          buttonText: t.results.actions.cancel,
          buttonIcon: <X className="size-4" />,
          onButtonClick: onCancel,
          useAnimatedDots: true,
          showButton: true,
        }
    }
  }

  const config = getStatusConfig()

  return (
    <div
      className={cn(
        "content-stretch flex items-start justify-start relative size-full",
        className
      )}
    >
      <div className="content-stretch flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 relative shrink-0 w-full">
        {/* Status Section */}
        <div className="flex flex-[1_0_0] flex-row items-center self-stretch">
          <div className="content-stretch flex flex-[1_0_0] flex-wrap gap-3 sm:gap-[16px] h-full items-baseline min-h-px min-w-px relative shrink-0">
            {/* Título "Verificações" */}
            <ResultsSectionTitle
              icon={<Sparkles className="size-[24px] text-slate-900" />}
              text={t.results.verifications}
            />

            {/* Status atual */}
            <div className="content-stretch flex gap-[8px] h-full items-center relative shrink-0">
              {/* Status Icon */}
              {config.icon}

              {/* Status Text */}
              <div className={cn(
                "flex flex-col font-[var(--font-inter)] font-medium justify-center leading-[0] not-italic relative shrink-0 text-[14px] whitespace-nowrap",
                config.textColor
              )}>
                {config.useAnimatedDots ? (
                  <AnimatedDots
                    text={config.text}
                    className="leading-[20px] whitespace-pre"
                    interval={500}
                  />
                ) : (
                  <p className="leading-[20px] whitespace-pre">{config.text}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Action Button */}
        {config.showButton && (
          <Button
            variant="outlined"
            size="sm"
            onClick={config.onButtonClick}
            disabled={disabled}
            className="gap-2"
          >
            {config.buttonIcon}
            {config.buttonText}
          </Button>
        )}
      </div>
    </div>
  )
}

export { ResultsHeader }
export type { ResultsHeaderProps, VerificationStatus }
