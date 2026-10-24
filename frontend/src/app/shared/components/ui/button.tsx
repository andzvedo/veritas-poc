import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[8px] transition-all disabled:cursor-not-allowed data-[state=loading]:pointer-events-none data-[state=loading]:opacity-50 [&_svg]:pointer-events-none shrink-0 [&_svg]:shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background [&_svg]:transition-colors",
  {
    variants: {
      variant: {
        // Filled (Figma: Filled Enabled/Hovered/Disabled)
        filled:
          "font-semibold bg-[#844ae9] text-white border border-[#351397] shadow-[0px_8px_24px_0px_rgba(83,44,219,0.50)] hover:bg-[#5d13dd] hover:shadow-[0px_12px_40px_0px_rgba(83,44,219,0.50)]  disabled:bg-[#c1a4f4] disabled:text-[#5d0bbc] disabled:opacity-100 disabled:shadow-none disabled:hover:bg-[#c1a4f4] disabled:hover:text-[#5d0bbc] disabled:hover:shadow-none",
        // Outlined (Figma: Outlined Enabled/Hovered/Disabled)
        outlined:
          "font-semibold bg-transparent text-[#8a5cda] border border-[#351397] hover:bg-neutral-100 hover:text-[#5d13dd] disabled:opacity-50 disabled:text-[#9d6eed] disabled:hover:bg-transparent disabled:hover:text-[#9d6eed] disabled:hover:opacity-50",
        // Link (Figma: Link SM/Default)
        link:
          "font-normal bg-transparent text-[#8a5cda] hover:text-[#5d13dd] hover:underline disabled:text-[#8a5cda] disabled:opacity-50 disabled:hover:text-[#8a5cda] disabled:hover:bg-transparent disabled:hover:no-underline disabled:hover:opacity-50 focus-visible:ring-0 focus-visible:ring-offset-0",
      },
      size: {
        // SM: 32px height para filled/outlined
        sm: "h-8 px-3 py-1 text-[14px] leading-[24px] [&_svg]:size-4",
        // Default: 48px height para filled/outlined
        default: "h-12 px-4 py-3 text-[16px] leading-[24px] [&_svg]:size-6",
        icon: "size-12",
      },
    },
    compoundVariants: [
      // Filled - Cor do stroke do SVG (branco para enabled/hovered, #7f34d4 para disabled)
      {
        variant: "filled",
        class: "[&_svg]:stroke-white disabled:[&_svg]:stroke-[#7f34d4] disabled:hover:[&_svg]:stroke-[#7f34d4]",
      },
      // Outlined - Cor do stroke do SVG (#9d6eed enabled, #5d13dd hover)
      {
        variant: "outlined",
        class: "[&_svg]:stroke-[#9d6eed] hover:[&_svg]:stroke-[#5d13dd] disabled:[&_svg]:stroke-[#9d6eed] disabled:hover:[&_svg]:stroke-[#9d6eed]",
      },
      // Link - Cor do stroke do SVG
      {
        variant: "link",
        class: "[&_svg]:stroke-[#9d6eed] hover:[&_svg]:stroke-[#5d13dd] disabled:[&_svg]:stroke-[#8a5cda] disabled:hover:[&_svg]:stroke-[#8a5cda]",
      },
      // Link SM - Padding específico do Figma
      {
        variant: "link",
        size: "sm",
        class: "px-1 py-0.5 text-[14px] leading-normal [&_svg]:size-4",
      },
      // Link Default - Padding específico do Figma
      {
        variant: "link",
        size: "default",
        class: "px-1.5 py-1 text-[16px] leading-normal [&_svg]:size-6",
      },
    ],
    defaultVariants: {
      variant: "filled",
      size: "default",
    },
  }
)

type ButtonProps = React.ComponentPropsWithoutRef<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    loading?: boolean
    /**
     * Tooltip a ser exibido quando o botão está desabilitado.
     * Melhora a acessibilidade ao explicar por que o botão não pode ser usado.
     * Aparece em hover, focus e tap/click.
     */
    disabledTooltip?: React.ReactNode
  }

const Button = React.forwardRef<React.ElementRef<"button">, ButtonProps>(
  ({ className, variant, size, asChild = false, loading, disabled, disabledTooltip, onClick, ...props }, ref) => {
    const Comp = asChild ? Slot : ("button" as const)
    const isDisabled = Boolean(loading || disabled)
    const showTooltip = isDisabled && disabledTooltip


    // Classes CSS para simular disabled quando tem tooltip (para manter focável)
    const getDisabledClasses = () => {
      if (!showTooltip) return ""

      const baseClasses = "cursor-not-allowed shadow-none"

      if (variant === "filled") {
        return cn(
          baseClasses,
          "bg-[#c1a4f4] text-[#5d0bbc] [&_svg]:stroke-[#7f34d4]",
          "hover:bg-[#c1a4f4] hover:text-[#5d0bbc] hover:[&_svg]:stroke-[#7f34d4] hover:shadow-none"
        )
      }
      if (variant === "outlined") {
        return cn(
          baseClasses,
          "opacity-50 text-[#9d6eed] [&_svg]:stroke-[#9d6eed]",
          "hover:bg-transparent hover:text-[#9d6eed] hover:opacity-50 hover:[&_svg]:stroke-[#9d6eed]"
        )
      }
      if (variant === "link") {
        return cn(
          baseClasses,
          "text-[#8a5cda] opacity-50 [&_svg]:stroke-[#8a5cda]",
          "hover:text-[#8a5cda] hover:bg-transparent hover:no-underline hover:opacity-50 hover:[&_svg]:stroke-[#8a5cda]"
        )
      }
      return baseClasses
    }

    // Handler para prevenir cliques quando desabilitado com tooltip
    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      if (showTooltip) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      onClick?.(e)
    }

    const buttonElement = (
      <Comp
        data-slot="button"
        data-state={loading ? "loading" : undefined}
        aria-busy={loading || undefined}
        aria-disabled={isDisabled || undefined}
        className={cn(
          buttonVariants({ variant, size, className }),
          getDisabledClasses(),
          // Garantir cursor not-allowed via aria-disabled também
          "aria-disabled:cursor-not-allowed"
        )}
        ref={ref}
        {...props}
        {...(!asChild
          ? {
              type: "button",
              // Se tem tooltip, não usar disabled nativo para permitir hover/focus
              disabled: showTooltip ? undefined : isDisabled,
              onClick: handleClick,
            }
          : { tabIndex: isDisabled && !showTooltip ? -1 : props.tabIndex })}
      />
    )

    // Se tem tooltip e está desabilitado, envolve com o Tooltip
    if (showTooltip) {
      return (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              {buttonElement}
            </TooltipTrigger>
            <TooltipContent>
              {disabledTooltip}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )
    }

    return buttonElement
  }
)

Button.displayName = "Button"

export { Button, buttonVariants }
