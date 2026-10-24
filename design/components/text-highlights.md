# Text Highlights Component

**Figma Link**: https://www.figma.com/design/QyHxg2phuY29PoHaxF631K/Veritas---FactChecker-Agent?node-id=574-14996&t=Gz2Ab9TDKiDqOuba-11

**Component Type**: Display/Interactive Text Component
**Location**: `frontend/src/app/shared/components/TextHighlight.tsx`
**Ladle Stories**: `frontend/src/app/shared/components/TextHighlight.stories.tsx`
**Ladle URL**: http://localhost:61000/?story=veritas--results--texthighlight--interactive

## Overview

Componente que exibe texto processado com highlights interativos para claims verificadas. Suporta 4 estados diferentes: sem highlights, com highlights, hover e selecionado.

## Visual Specifications (from Figma)

### Layout
- **Container**: Full width, flex column, gap 16px
- **Header**: Flex row, items center, gap 16px
- **Text Area**: Padding 8px, flex column

### Typography
- **Font Family**: Merriweather (Regular)
- **Font Size**: 14px
- **Line Height**: 28px
- **Letter Spacing**: 0.14px
- **Text Color**: #707070 (gray)

### Claim Highlight Colors
- **Claim Number/Text**: #5d13dd (purple)
- **Hover Underline**: rgba(93,19,221,0.5) with 55% offset
- **Selected Background**: #e3d9f7 (light purple)
- **Selected Text**: #4200b4 (darker purple)
- **Selected Underline**: rgba(66,0,180,0.85)

### States

#### 1. Sem Highlights (Default)
- Plain text without any highlights
- All text in #707070 color
- No interactive elements

#### 2. Highlights
- Claims numbered (1., 2., 3.)
- Claim numbers and text in #5d13dd
- No underline in default state
- Claims are interactive

#### 3. Highlights Hover
- Underline appears on hover
- Underline color: rgba(93,19,221,0.5)
- Underline offset: 55%
- Text decoration skip ink: none

#### 4. Highlights Selected
- Background overlay: #e3d9f7
- Text color changes to #4200b4
- Underline color: rgba(66,0,180,0.85)
- Background has subtle padding
- Rest of text gets 70% opacity

## Component Structure

```tsx
interface Claim {
  id: string;
  number: number;
  text: string;
  startIndex: number;
  endIndex: number;
}

interface TextSegment {
  type: 'text' | 'claim';
  content: string;
  claimId?: string;
  claimNumber?: number;
}

interface TextHighlightProps {
  // Content
  text: string;
  claims?: Claim[];

  // State
  selectedClaimId?: string;
  hoveredClaimId?: string;

  // Behavior
  onClaimClick?: (claimId: string) => void;
  onClaimHover?: (claimId: string | null) => void;

  // Styling
  className?: string;

  // Accessibility
  ariaLabel?: string;
}
```

## Behavior

### Interactive States
1. **Default**: Claims are colored but not underlined
2. **Hover**: Claim gets underline with 50% opacity
3. **Selected**: Claim gets background color and darker text
4. **Disabled**: No highlights shown (Sem Highlights state)

### Text Parsing
- Parse text to identify claim positions
- Split text into segments (plain text vs claims)
- Render each segment with appropriate styling
- Handle overlapping claims (if any)

### Event Handling
- Click on claim: Select claim and trigger callback
- Hover on claim: Show underline and trigger callback
- Mouse leave: Remove hover state

## Implementation Details

### Styling Approach
- Use Tailwind classes for base styling
- Use inline styles for dynamic colors from Figma
- CSS custom properties for theme colors
- Conditional classes for different states

### Key CSS Classes
```css
/* Base text */
.text-highlight-base {
  font-family: var(--font-merriweather);
  font-size: 14px;
  line-height: 28px;
  letter-spacing: 0.14px;
  color: #707070;
}

/* Claim default */
.text-highlight-claim {
  color: #5d13dd;
  cursor: pointer;
  transition: text-decoration 0.2s ease;
}

/* Claim hover */
.text-highlight-claim:hover {
  text-decoration: underline;
  text-decoration-color: rgba(93,19,221,0.5);
  text-underline-offset: 55%;
  text-decoration-skip-ink: none;
}

/* Claim selected */
.text-highlight-claim-selected {
  background-color: #e3d9f7;
  color: #4200b4;
  text-decoration: underline;
  text-decoration-color: rgba(66,0,180,0.85);
  text-underline-offset: 55%;
  text-decoration-skip-ink: none;
  padding: 0 1px;
}

/* Text dimmed when claim selected */
.text-highlight-dimmed {
  opacity: 0.7;
}
```

### Component Logic
1. Parse claims array to create text segments
2. Render each segment with appropriate wrapper
3. Apply conditional styling based on hover/selected state
4. Handle click and hover events
5. Manage selected claim state

## Accessibility

- Use semantic HTML for text structure
- Add `role="button"` for clickable claims
- Add `aria-label` for screen readers
- Add `tabIndex` for keyboard navigation
- Support keyboard selection (Enter/Space)
- Announce state changes to screen readers

## Usage Examples

### Basic Usage
```tsx
<TextHighlight
  text="Global temperatures have risen by 10 degrees."
  claims={[
    {
      id: "claim-1",
      number: 1,
      text: "Global temperatures have risen by 10 degrees",
      startIndex: 0,
      endIndex: 47
    }
  ]}
/>
```

### With Selection
```tsx
<TextHighlight
  text="Global temperatures have risen by 10 degrees."
  claims={claims}
  selectedClaimId="claim-1"
  onClaimClick={(id) => console.log('Claim clicked:', id)}
/>
```

### Without Highlights
```tsx
<TextHighlight
  text="Global temperatures have risen by 10 degrees."
  claims={[]}
/>
```

## Ladle Stories

### Stories to Create
1. **Sem Highlights** - Plain text without claims
2. **Com Highlights** - Text with multiple claims
3. **Hover State** - Interactive hover demonstration
4. **Selected State** - Claim selected with background
5. **Multiple Claims** - Text with 3+ claims
6. **Long Text** - Full transcript with multiple speakers

## Integration Notes

### Data Flow
1. Backend sends transcript with claim positions
2. Frontend parses claims and creates segments
3. Component renders interactive text
4. User clicks claim → triggers verification panel
5. Selected claim updates visual state

### State Management
- Selected claim ID stored in parent component
- Hover state managed internally
- Click events bubble up to parent
- Sync with verification panel state

## Design Tokens

```css
:root {
  /* Text Highlight Colors */
  --text-highlight-base: #707070;
  --text-highlight-claim: #5d13dd;
  --text-highlight-claim-dark: #4200b4;
  --text-highlight-bg: #e3d9f7;
  --text-highlight-underline: rgba(93,19,221,0.5);
  --text-highlight-underline-selected: rgba(66,0,180,0.85);
}
```

## Figma Code Reference

```tsx
// Claim text styling (from Figma)
<span className="text-[#5d13dd]">1. </span>
<span className="font-['Merriweather:Regular',_sans-serif] leading-[28px] not-italic text-[#5d13dd] tracking-[0.14px]">
  Global temperatures have risen by 10 degrees.
</span>

// Hover state
<span className="[text-decoration-skip-ink:none] [text-underline-offset:55%] decoration-[rgba(93,19,221,0.5)] decoration-solid font-['Merriweather:Regular',_sans-serif] leading-[28px] not-italic tracking-[0.14px] underline">
  Global temperatures have risen by 10 degrees.
</span>

// Selected state
<div className="absolute bg-[#e3d9f7] box-border content-stretch flex gap-[8px] items-center justify-center left-[3px] px-px py-0 top-0">
  <p className="[text-decoration-skip-ink:none] [text-underline-offset:55%] decoration-[rgba(66,0,180,0.85)] decoration-solid font-['Merriweather:Regular',_sans-serif] leading-[28px] not-italic text-[#4200b4] text-[14px] tracking-[0.14px] underline">
    1. Global temperatures have risen by 10 degrees.
  </p>
</div>
```

## Testing Checklist

- [ ] Renders plain text without claims
- [ ] Renders text with single claim
- [ ] Renders text with multiple claims
- [ ] Hover shows underline
- [ ] Click selects claim
- [ ] Selected claim shows background
- [ ] Selected claim dims other text
- [ ] Keyboard navigation works
- [ ] Screen reader announces claims
- [ ] Mobile touch interactions work
- [ ] Long text scrolls properly
- [ ] Claims don't overlap incorrectly
