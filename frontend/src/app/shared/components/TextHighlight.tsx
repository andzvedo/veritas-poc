"use client";

import React, { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Representa uma claim (afirmação) no texto
 */
export interface Claim {
  id: string;
  number: number;
  text: string;
  startIndex: number;
  endIndex: number;
}

/**
 * Segmento de texto (pode ser texto normal ou uma claim)
 */
interface TextSegment {
  type: 'text' | 'claim';
  content: string;
  claimId?: string;
  claimNumber?: number;
}

export interface TextHighlightProps {
  // Content
  text: string;
  claims?: Claim[];

  // State
  selectedClaimId?: string;

  // Behavior
  onClaimClick?: (claimId: string) => void;

  // Styling
  className?: string;

  // Accessibility
  ariaLabel?: string;
}

/**
 * TextHighlight - Componente de texto com highlights interativos para claims
 * Design: Node 574:14996 (Text Highlights)
 *
 * Especificações do Figma:
 * - Font: Merriweather Regular
 * - Font Size: 14px
 * - Line Height: 28px
 * - Letter Spacing: 0.14px
 * - Text Color (base): #707070
 * - Claim Color: #5d13dd
 * - Hover Underline: rgba(93,19,221,0.5)
 * - Selected Background: #e3d9f7
 * - Selected Text: #4200b4
 * - Selected Underline: rgba(66,0,180,0.85)
 *
 * Estados:
 * 1. Sem Highlights - Texto plano sem destaques
 * 2. Highlights - Claims numeradas em roxo
 * 3. Highlights Hover - Underline ao passar o mouse
 * 4. Highlights Selected - Background roxo claro e texto mais escuro
 */
export const TextHighlight: React.FC<TextHighlightProps> = ({
  text,
  claims = [],
  selectedClaimId,
  onClaimClick,
  className,
  ariaLabel
}) => {
  const [hoveredClaimId, setHoveredClaimId] = useState<string | null>(null);

  /**
   * Parse o texto e divide em segmentos (texto normal vs claims)
   */
  const parseTextSegments = (): TextSegment[] => {
    if (!claims || claims.length === 0) {
      return [{ type: 'text', content: text }];
    }

    const segments: TextSegment[] = [];
    let lastIndex = 0;

    // Ordena claims por posição no texto
    const sortedClaims = [...claims].sort((a, b) => a.startIndex - b.startIndex);

    sortedClaims.forEach((claim) => {
      if (claim.startIndex < lastIndex || claim.startIndex < 0 ||
          claim.endIndex > text.length || claim.endIndex <= claim.startIndex) return;
      // Adiciona texto antes da claim
      if (claim.startIndex > lastIndex) {
        segments.push({
          type: 'text',
          content: text.substring(lastIndex, claim.startIndex)
        });
      }

      // Adiciona a claim
      segments.push({
        type: 'claim',
        content: text.slice(claim.startIndex, claim.endIndex),
        claimId: claim.id,
        claimNumber: claim.number
      });

      lastIndex = claim.endIndex;
    });

    // Adiciona texto restante após a última claim
    if (lastIndex < text.length) {
      segments.push({
        type: 'text',
        content: text.substring(lastIndex)
      });
    }

    return segments;
  };

  /**
   * Renderiza um segmento de texto normal
   */
  const renderTextSegment = (segment: TextSegment, index: number) => {
    const isTextDimmed = selectedClaimId && segment.type === 'text';

    return (
      <span
        key={`text-${index}`}
        className={cn(
          isTextDimmed && "opacity-70"
        )}
      >
        {segment.content}
      </span>
    );
  };

  /**
   * Renderiza um segmento de claim (interativo)
   */
  const renderClaimSegment = (segment: TextSegment, index: number) => {
    const isSelected = selectedClaimId === segment.claimId;
    const isHovered = hoveredClaimId === segment.claimId;

    const handleClick = () => {
      if (onClaimClick && segment.claimId) {
        onClaimClick(segment.claimId);
      }
    };

    const handleMouseEnter = () => {
      setHoveredClaimId(segment.claimId || null);
    };

    const handleMouseLeave = () => {
      setHoveredClaimId(null);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleClick();
      }
    };

    return (
      <span
        key={`claim-${index}`}
        id={`claim-${segment.claimId}`}
        role="button"
        aria-pressed={isSelected}
        tabIndex={0}
        aria-label={`${segment.claimNumber}. ${segment.content}`}
        className={cn(
          "cursor-pointer scroll-mt-4 transition-all duration-200 focus-visible:outline-2 focus-visible:outline-purple-600",
          // Estado selecionado
          isSelected && "bg-[#e3d9f7] px-px",
          isSelected && "[text-decoration:underline] [text-decoration-color:rgba(66,0,180,0.85)] [text-underline-offset:55%] [text-decoration-skip-ink:none]",
          // Estado hover (apenas se não estiver selecionado)
          !isSelected && isHovered && "[text-decoration:underline] [text-decoration-color:rgba(93,19,221,0.5)] [text-underline-offset:55%] [text-decoration-skip-ink:none]"
        )}
        style={{
          color: isSelected ? '#4200b4' : '#5d13dd'
        }}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onKeyDown={handleKeyDown}
      >
        {segment.claimNumber}. {segment.content}
      </span>
    );
  };

  const segments = parseTextSegments();

  return (
    <div
      className={cn(
        "w-full font-[var(--font-merriweather)] text-[14px] leading-[28px] tracking-[0.14px]",
        "whitespace-pre-wrap",
        className
      )}
      style={{ color: '#707070' }}
      aria-label={ariaLabel}
    >
      {segments.map((segment, index) => {
        if (segment.type === 'claim') {
          return renderClaimSegment(segment, index);
        }
        return renderTextSegment(segment, index);
      })}
    </div>
  );
};

export default TextHighlight;
