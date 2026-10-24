import React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Settings } from 'lucide-react';
import { Button } from '@/app/shared/components/ui/button';
import { useI18n } from '@/lib/i18n/I18nContext';
import LanguageSwitcher from './LanguageSwitcher';

interface HeaderProps {
  className?: string;
  onSettingsClick?: () => void;
  showSettings?: boolean;
  rightContent?: React.ReactNode;
  showLanguageSwitcher?: boolean;
}

/**
 * Header - Top-bar consistente em todas as páginas
 * Design v0.2: Conforme especificado no design document
 *
 * Especificações:
 * - Logo: Inria Serif Bold, 24px, #102148
 * - Tagline: Inter Regular, 12px, #737b91, opacity 90%
 * - Botão Settings: Ícone 24px, texto 16px, cor #8a5cda
 * - Divider: 1px linha horizontal
 * - Padding: 16px top, 0px bottom
 * - Background: #f5f5f5 (neutral-100)
 */
const Header: React.FC<HeaderProps> = ({
  className,
  onSettingsClick,
  showSettings = false,
  rightContent,
  showLanguageSwitcher = true
}) => {
  const { t } = useI18n();

  return (
    <header
      className={cn(
        'flex flex-col gap-3 sm:gap-4 pt-3 sm:pt-4 pb-0 relative w-full bg-neutral-100',
        className
      )}
    >
      {/* Container principal */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        {/* Logo e Tagline à esquerda */}
        <Link
          href="/"
          aria-label={t.header.homeAriaLabel}
          className="flex flex-col leading-[0]"
        >
          <span
            className="font-bold text-xl sm:text-2xl leading-7 sm:leading-8 tracking-[0.48px] whitespace-pre-wrap"
            style={{
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-inria-serif), "Inria Serif", Georgia, serif'
            }}
          >
            {t.common.appName}
          </span>
          <span
            className="font-normal text-[10px] sm:text-xs leading-4 sm:leading-5 tracking-[0.24px] whitespace-pre-wrap opacity-90"
            style={{
              color: 'var(--text-tagline)',
              fontFamily: 'var(--font-inter), Inter, sans-serif'
            }}
          >
            {t.common.tagline}
          </span>
        </Link>

        {/* Right side content */}
        <div className="flex items-center gap-2 sm:gap-4">
          {/* Language Switcher */}
          {showLanguageSwitcher && (
            <LanguageSwitcher variant="compact" />
          )}

          {/* Botão Configurations (Settings) */}
          {rightContent ? (
            rightContent
          ) : (
            showSettings && onSettingsClick && (
              <Button
                variant="link"
                size="default"
                onClick={onSettingsClick}
                aria-label={t.header.settingsAriaLabel}
                title={t.header.settingsTitle}
                className="text-sm sm:text-base"
              >
                <Settings className="w-5 h-5 sm:w-6 sm:h-6" />
                <span className="hidden sm:inline">{t.common.settings}</span>
              </Button>
            )
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="h-0 w-full relative">
        <div className="absolute bottom-0 left-0 right-0 top-[-1px] border-t" style={{ borderColor: 'var(--divider)' }} />
      </div>
    </header>
  );
};

export default Header;


