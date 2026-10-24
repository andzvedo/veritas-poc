# ResultCard Component

**Figma Link**: https://www.figma.com/design/QyHxg2phuY29PoHaxF631K/Veritas---FactChecker-Agent?node-id=762-24541

**Ladle Stories**: http://localhost:61000/?story=veritas--results--resultcard--interactive

## Overview
Card component que exibe um resultado individual de verificação de fato, incluindo a afirmação, análise e fontes.

## States
- **Default**: Estado padrão do card
- **Hover**: Estado quando o mouse está sobre o card (borda roxa)
- **Selected**: Estado quando o card está selecionado (borda roxa mais forte + fundo roxo claro)

## Visual Specs (from Figma)

### Container
- **Border Radius**: `16px` (rounded-2xl)
- **Padding**: `24px 16px 16px 16px` (pt-6 px-4 pb-4)
- **Background**: `#ffffff` (bg-white)
- **Border**: `1px solid #d9d9d9` (border-card)
- **Gap**: `16px` (gap-4)

### States Styling
#### Default
- Border: `1px solid #d4d4d8` (zinc-300)
- Background: `#FCFCFC`

#### Hover
- Border: `2px solid #844ae9` (border-hover-purple)
- Background: `#ffffff` (white)
- Shadow: `0px 4px 16px 0px rgba(95, 0, 179, 0.30)` (shadow-card-hover)

#### Selected
- Border: `2px solid #af89f1` (border-selected-purple)
- Background: `#ffffff` (white)
- Shadow: `0px 20px 80px 0px rgba(137, 44, 219, 0.2)` (shadow-card-selected)

### Claim Text Section
- **Font**: Merriweather Regular
- **Size**: `14px`
- **Line Height**: `28px`
- **Color**: `rgba(29, 30, 31, 0.9)` (text-opacity-dark)
- **List Style**: Decimal (numbered list)
- **Padding Right**: `16px`
- **Gap**: `8px`

### Analysis Section
- **Background**: `rgba(245, 245, 245, 0.5)` (bg-analysis)
- **Border**: `1px solid #d8d8d8` (border-analysis)
- **Border Radius**: `12px` (rounded-xl)
- **Padding**: `16px` (p-4)
- **Gap**: `8px` (gap-2)

#### Analysis Label
- **Font**: Inter Medium
- **Size**: `14px`
- **Line Height**: `24px`
- **Color**: `#716793` (text-helper)

#### Analysis Text
- **Font**: Inter Regular
- **Size**: `16px`
- **Line Height**: `28px`
- **Color**: `rgba(29, 30, 31, 0.9)` (text-opacity-dark)

### Sources Section
- **Padding**: `0 8px` (px-2)
- **Gap**: `8px` (gap-2)

#### Sources Label
- **Font**: Inter Medium
- **Size**: `14px`
- **Line Height**: `24px`
- **Color**: `#716793` (text-helper)
- **Padding**: `0 8px` (px-2)

#### Source Links Container
- **Display**: Flex wrap
- **Gap**: `4px 8px` (gap-1 gap-x-2)

#### Individual Source Link
- **Background**: `#f5f5f5` (bg-neutral-100)
- **Border Radius**: `8px` (rounded-lg)
- **Padding**: `2px 6px` (py-0.5 px-1.5)
- **Gap**: `8px` (gap-2)
- **Font**: Inter Regular
- **Size**: `13px`
- **Line Height**: `24px`
- **Color**: `#5d13dd` (purple-link) for first link, `#8a5cda` (purple-hover) for others
- **Text Decoration**: Underline for first link
- **Icon**: ExternalLink (Lucide) - 16px

## TypeScript Interface

```typescript
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
```

## CSS Variables Used

```css
/* Borders */
--border-card: #d9d9d9;
--border-analysis: #d8d8d8;
--border-hover-purple: #844ae9;
--border-selected-purple: #af89f1;

/* Backgrounds */
--bg-analysis: rgba(245, 245, 245, 0.5);

/* Text Colors */
--text-opacity-dark: rgba(29, 30, 31, 0.9);
--text-helper: #716793;

/* Purple Colors */
--purple-button: #844ae9;
--purple-link: #5d13dd;
--purple-hover: #8a5cda;

/* Shadows */
--shadow-card-selected: 0px 20px 80px 0px rgba(137, 44, 219, 0.2);
--shadow-card-hover: 0px 4px 16px 0px rgba(95, 0, 179, 0.30);
```

## Implementation Notes

1. **State Management**: O componente deve aceitar `isSelected` como prop para controlar o estado selecionado
2. **Hover State**: Implementado via CSS `:hover` pseudo-class
3. **Numbered List**: Usar `<ol>` com `start={index}` para numeração correta
4. **Source Links**:
   - Primeiro link tem underline e cor `purple-link`
   - Demais links têm cor `purple-hover` sem underline
   - Todos os links têm hover state
5. **Icon System**: Usar Lucide React `ExternalLink` icon
6. **Responsive**: Card deve ser full-width (`w-full`)
7. **Cursor**: `cursor-pointer` para indicar interatividade
8. **Transition**: Smooth transitions para hover/selected states (`transition-all duration-200`)

## Ladle Stories

Stories devem incluir:
- **Default**: Card no estado padrão
- **Hover**: Card com hover (via CSS)
- **Selected**: Card selecionado
- **Without Sources**: Card sem fontes
- **Without Explanation**: Card sem análise
- **Interactive**: Story interativa com múltiplos cards

## Usage Example

```tsx
<ResultCard
  text="As vacinas contra COVID-19 foram desenvolvidas em tempo recorde em 2020."
  explanation="A afirmação é verdadeira. Diversas vacinas contra a COVID-19..."
  sources={[
    "https://www.nasa.gov/climate",
    "https://www.noaa.gov/climate",
    "https://www.ipcc.ch"
  ]}
  index={1}
  isSelected={false}
  onClick={() => handleCardClick()}
/>
```
