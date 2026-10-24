"use client";

import React from 'react';
import { FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n/I18nContext';

interface ComingSoonBannerProps {
  className?: string;
}

/**
 * ComingSoonBanner - Componente que exibe features futuras
 * Design: Node 635:16187 do Figma
 *
 * Especificações:
 * - Background: #f1f1f1
 * - Border: 1px solid #dedfe3
 * - Icons: FileText e AudioLines (Lucide), 20px
 * - Cor dos ícones: #731fb8
 * - Texto: Inter Regular/Semi Bold, 14px
 * - Cor do texto: #6e678a
 */
export const ComingSoonBanner: React.FC<ComingSoonBannerProps> = ({ className }) => {
  const { t } = useI18n();

  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2 px-1.5 py-1 rounded",
        "bg-[var(--coming-soon-bg)] border border-[var(--coming-soon-border)]",
        className
      )}
    >
      {/* Text files still upcoming; live microphone capture is available via ModeToggle. */}
      <div className="flex items-center gap-1">
        <FileText className="w-5 h-5" style={{ color: 'var(--purple-accent)' }} />
        <p className="text-sm leading-6 text-[var(--text-muted)]">
          <span className="font-semibold">{t.comingSoon.textFiles}</span>{' '}
          {t.comingSoon.message}
        </p>
      </div>
    </div>
  );
};

export default ComingSoonBanner;
