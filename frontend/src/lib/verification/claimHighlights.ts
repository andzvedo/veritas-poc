export interface ClaimHighlight {
  id: string;
  number: number;
  text: string;
  startIndex: number;
  endIndex: number;
}

interface ClaimText {
  id: string;
  text: string;
}

// Keep offsets into the original text when matching punctuation and whitespace.
function normalize(text: string) {
  let value = '';
  const offsets: number[] = [];
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const numericSeparator = /[.,]/.test(char) &&
      /[0-9]/.test(text[index - 1] ?? '') && /[0-9]/.test(text[index + 1] ?? '');
    if (/[.,!?;:"']/.test(char) && !numericSeparator) continue;
    const normalized = /\s/.test(char) ? ' ' : char.toLowerCase();
    if (normalized === ' ' && value.endsWith(' ')) continue;
    for (const part of normalized) {
      value += part;
      offsets.push(index);
    }
  }
  return { value, offsets };
}

export function findClaimHighlights(text: string, results: readonly ClaimText[]): ClaimHighlight[] {
  const highlights: ClaimHighlight[] = [];
  const normalizedText = normalize(text);
  const available = (start: number, end: number) =>
    !highlights.some((claim) => start < claim.endIndex && end > claim.startIndex);

  results.forEach((result, index) => {
    const quote = result.text.trim().replace(/^["']|["']$/g, '').trim();
    if (!quote) return;

    let start = text.indexOf(quote);
    while (start !== -1 && !available(start, start + quote.length)) {
      start = text.indexOf(quote, start + 1);
    }
    let end = start + quote.length;

    if (start === -1) {
      const query = normalize(quote).value.trim();
      if (!query) return;
      let match = normalizedText.value.indexOf(query);
      while (match !== -1) {
        start = normalizedText.offsets[match];
        end = normalizedText.offsets[match + query.length - 1] + 1;
        if (available(start, end)) break;
        match = normalizedText.value.indexOf(query, match + 1);
      }
      if (match === -1) return;
    }

    highlights.push({
      id: result.id,
      number: index + 1,
      text: text.slice(start, end),
      startIndex: start,
      endIndex: end,
    });
  });

  return highlights.sort((a, b) => a.startIndex - b.startIndex);
}
