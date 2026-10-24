"use client";

import React from 'react';
import { cn } from '@/lib/utils';
import { ExternalLink, AlertTriangle } from 'lucide-react';
import { Button } from '@/app/shared/components/ui/button';

interface ResultCardProps {
  // Content
  text: string;
  explanation?: string;
  sources?: string[];
  index: number; // For numbered list

  // State
  isSelected?: boolean;

  // Behavior
  onClick?: () => void;

  // Styling
  className?: string;

  // Accessibility
  id?: string;
}

const ResultCard: React.FC<ResultCardProps> = ({
  text,
  explanation,
  sources,
  index,
  isSelected = false,
  onClick,
  className,
  id
}) => {
  return (
    <div
      id={id}
      className={cn(
        // Base styles
        "bg-[#FCFCFC] relative rounded-2xl shrink-0 w-full transition-all duration-200 cursor-pointer",
        // Default outline
        "outline outline-1 outline-zinc-300 outline-offset-[-1px]",
        // Hover state
        "hover:bg-[#FAF7FF] hover:outline-2 hover:outline-[var(--border-hover-purple)] hover:outline-offset-[-2px] hover:shadow-[var(--shadow-card-hover)]",
        // Selected state
        isSelected && [
          "outline-2 outline-[var(--border-selected-purple)] outline-offset-[-2px]",
          "bg-white",
          "shadow-[var(--shadow-card-selected)]"
        ],
        // Scroll margin for proper spacing when scrolling into view
        "scroll-mt-4",
        className
      )}
      onClick={onClick}
    >
      <div className="box-border content-stretch flex flex-col gap-3 sm:gap-4 items-start overflow-clip pb-3 sm:pb-4 pt-4 sm:pt-6 px-3 sm:px-4 relative rounded-[inherit] w-full">
        {/* Claim Text com numeração */}
        <div className="box-border content-stretch flex gap-2 items-start justify-center pl-0 pr-2 sm:pr-4 py-0 relative rounded-lg shrink-0 w-full">
          <div className="flex-[1_0_0] flex-col justify-center min-h-px min-w-px not-italic relative shrink-0 text-sm text-[var(--text-opacity-dark)]">
            <ol
              className="list-decimal"
              start={index}
              style={{ fontFamily: 'var(--font-merriweather)' }}
            >
              <li className="ms-[21px]">
                <span
                  className="leading-7 line-clamp-2"
                  style={{
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}
                >
                  &ldquo;{text}&rdquo;
                </span>
              </li>
            </ol>
          </div>
        </div>

        {/* Análise e Fontes */}
        <div className="content-stretch flex flex-col gap-3 items-center relative shrink-0 w-full">
          {/* Explanation/Análise */}
          {explanation && (
            <div className="bg-[var(--bg-analysis)] border border-[var(--border-analysis)] border-solid box-border content-stretch flex flex-col gap-2 items-start p-3 sm:p-4 relative rounded-xl shrink-0 w-full">
              <div className="content-stretch flex gap-2 items-center relative shrink-0 w-full">
                <div className="flex flex-col font-['Inter'] font-medium justify-center leading-[0] not-italic relative shrink-0 text-[var(--text-helper)] text-sm whitespace-nowrap">
                  <p className="leading-6">Análise</p>
                </div>
              </div>
              <div className="flex flex-col font-['Inter'] font-normal justify-center leading-6 sm:leading-7 min-w-full not-italic relative shrink-0 text-sm sm:text-base text-[var(--text-opacity-dark)] w-[min-content] whitespace-pre-wrap">
                <p>{explanation}</p>
              </div>
            </div>
          )}

          {/* Sources/Fontes */}
          <div className="box-border content-stretch flex flex-col gap-2 items-start px-2 py-0 relative shrink-0 w-full">
            <div className="box-border content-stretch flex gap-2 items-center px-2 py-0 relative shrink-0 w-full">
              <div className="flex flex-col font-['Inter'] font-medium justify-center leading-[0] not-italic relative shrink-0 text-[var(--text-helper)] text-sm whitespace-nowrap">
                <p className="leading-6">Fontes</p>
              </div>
            </div>
            <div className="content-start flex flex-wrap gap-1 gap-x-2 items-start relative shrink-0 w-full">
              {sources && sources.length > 0 ? (
                sources.map((source: string, sourceIndex: number) => {
                  let displayText = source;
                  try {
                    displayText = new URL(source).hostname.replace('www.', '');
                  } catch {
                    // Se não for uma URL válida, usa o texto original
                    displayText = source.length > 30 ? source.substring(0, 30) + '...' : source;
                  }

                  return (
                    <Button
                      key={sourceIndex}
                      variant="link"
                      size="sm"
                      asChild
                      className="rounded-lg"
                    >
                      <a
                        href={source}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-2"
                      >
                        <span className="text-[13px]">{displayText}</span>
                        <ExternalLink className="size-4" />
                      </a>
                    </Button>
                  );
                })
              ) : (
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[#351397] text-[#8a5cda] text-[14px] leading-normal">
                  <AlertTriangle className="size-4" />
                  <span>Nenhuma fonte encontrada</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
export default ResultCard;
