import { ParsingError, ValidationError } from '#/utils/errors.js';
import { sanitizeJsonForTemplate } from '#/utils/llm.js';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { CLAIM_SCHEMA, type AtomicClaim, type Claim } from '@veritas/shared';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/**
 * Claim extraction only: this module decomposes speech into atomic, verifiable
 * propositions and performs the NOT_FACT_CHECKABLE triage. It never judges
 * truth, never searches and never emits a verdict.
 */

const MAX_ERROR_EXCERPT = 600;

export const EXTRACTED_CLAIM_SCHEMA = z.object({
  originalQuote: z
    .string()
    .min(1)
    .describe(
      'Trecho literal da fala, copiado exatamente do INPUT, sem correções, elipses ou colchetes editoriais.',
    ),
  normalizedClaim: z
    .string()
    .min(1)
    .describe(
      'Reescrita neutra da proposição, preservando sujeito, negação, período, quantidade, unidade e universo.',
    ),
  notFactCheckable: z
    .boolean()
    .default(false)
    .describe(
      'true para opinião, promessa, pergunta, retórica ou qualquer fala não verificável documentalmente; nesse caso não preencha os campos abaixo.',
    ),
  subject: z
    .string()
    .min(1)
    .optional()
    .describe('Pessoa, órgão ou instituição a que a proposição se refere.'),
  predicate: z
    .string()
    .min(1)
    .optional()
    .describe('Ação, estado ou relação afirmada sobre o sujeito.'),
  period: z
    .object({
      start: z.string().optional(),
      end: z.string().optional(),
    })
    .optional()
    .describe('Período afirmado, com os limites explícitos na fala.'),
  populationOrScope: z
    .string()
    .min(1)
    .optional()
    .describe(
      'População, local, programa ou recorte a que a proposição se aplica.',
    ),
  quantity: z
    .object({
      value: z.number(),
      unit: z.string().min(1),
    })
    .optional()
    .describe('Quantidade explícita: value como número JSON e unit como dito.'),
});
export type ExtractedClaim = z.infer<typeof EXTRACTED_CLAIM_SCHEMA>;

export const EXTRACTION_RESPONSE_SCHEMA = z.array(EXTRACTED_CLAIM_SCHEMA);
export type ExtractionResponse = z.infer<typeof EXTRACTION_RESPONSE_SCHEMA>;

export type ExtractionSource = {
  sessionId?: string;
  segmentIds: string[];
  speakerId?: string;
  timestampMs?: { start: number; end: number };
};

export type ExtractClaimsArgs = {
  text: string;
  /** Bounded, speaker-labelled window produced by `ContextManager`. */
  context?: string;
  llm: BaseChatModel;
  source: ExtractionSource;
  /** Stable id prefix so the same extraction can be reproduced in tests. */
  fingerprint?: string;
};

export type ExtractionPromptInput = {
  text: string;
  context?: string;
};

const SYSTEM_PROMPT = `You are a fact-checking analyst that only extracts claims from live political speech.

TASK
Read the PREVIOUS CONTEXT (prior turns, other speakers, references) and the INPUT (the utterance to analyze).
Extract only the verifiable atomic propositions that the INPUT speaker actually asserted.

RULES
- Never judge truth, falsity, likelihood, intent or quality. Never search the web, never use outside knowledge and never propose a verdict, status or confidence.
- Opinions, promises, questions, greetings, pure rhetoric and anything that cannot be checked against documents must be returned as a single entry with "notFactCheckable": true. Do not turn them into a claim.
- Do not silently drop a relevant statement: each statement of the INPUT is either a fact-checkable entry or a NOT_FACT_CHECKABLE entry. When the INPUT has nothing to extract, return [].
- originalQuote must be an exact literal substring of INPUT: no paraphrase, no spelling correction, no ellipsis and no editorial brackets such as "[Lula]".
- normalizedClaim is a neutral restatement used only as a search query. It must preserve the subject, the negation, the period, the quantity, the unit and the population/scope asserted in the speech.
- One entry per atomic proposition. Split conjunctions, comparisons and lists ("e", "além disso", "assim como") into separate entries; each entry gets its own investigation later.
- Use the PREVIOUS CONTEXT only to resolve pronouns and references of the INPUT (e.g. "ele", "esse valor", "aqui"). Never import facts from the context into originalQuote and never extend the speech with permanence, exclusivity, responsibility or intent that was not said.
- Never merge two speakers: attribute only the words of the INPUT speaker and never move another speaker's words into this claim.
- Fill subject, predicate, period, populationOrScope and quantity only when they are explicit in the speech. quantity.value must be a JSON number; quantity.unit keeps the spoken unit ("R$", "%", "bilhões", "pessoas").
- Respond in the input language (Brazilian Portuguese) for originalQuote, normalizedClaim and the structured fields. Never translate or normalize the quote itself.
- Return only valid JSON. No markdown, no code fences, no explanations. Start with [ and end with ]. An empty array [] is a valid answer.
- Follow the JSON SCHEMA block exactly.

JSON SCHEMA:
\`\`\`json
${sanitizeJsonForTemplate(z.toJSONSchema(EXTRACTION_RESPONSE_SCHEMA))}
\`\`\`

PREVIOUS CONTEXT (other speakers and prior turns; may be empty):
{context}

INPUT (utterance to extract claims from):
{input}
`;

export const EXTRACTION_PROMPT = ChatPromptTemplate.fromTemplate(SYSTEM_PROMPT);

function promptValues({ text, context }: ExtractionPromptInput): {
  context: string;
  input: string;
} {
  return { context: context?.trim() ?? '', input: text };
}

/**
 * Renders the exact prompt text for one input, without calling the model.
 * Kept pure so prompt rules can be asserted in tests.
 */
export function buildExtractionPrompt(input: ExtractionPromptInput): string {
  const { context, input: text } = promptValues(input);
  return SYSTEM_PROMPT.replace(/\{\{/g, '{')
    .replace(/\}\}/g, '}')
    .replace('{context}', () => context)
    .replace('{input}', () => text);
}

function excerpt(value: string): string {
  const trimmed = value.trim();
  return trimmed.length <= MAX_ERROR_EXCERPT
    ? trimmed
    : `${trimmed.slice(0, MAX_ERROR_EXCERPT)}…`;
}

function stripCodeFences(raw: string): string {
  return raw.replace(/```(?:json)?\s*|\s*```/g, '').trim();
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map(
      (issue) =>
        `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`,
    )
    .join('; ');
}

function parseExtractionResponse(raw: string): ExtractedClaim[] {
  const cleaned = stripCodeFences(raw);
  if (cleaned.length === 0) {
    throw new ParsingError(
      'A extração de claims recebeu uma resposta vazia do modelo; esperava um array JSON.',
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(cleaned);
  } catch (error) {
    throw new ParsingError(
      `A extração de claims recebeu JSON inválido (${error instanceof Error ? error.message : String(error)}): ${excerpt(cleaned)}`,
    );
  }

  const result = EXTRACTION_RESPONSE_SCHEMA.safeParse(parsedJson);
  if (!result.success) {
    throw new ParsingError(
      `A extração de claims recebeu JSON fora do schema (${describeIssues(result.error)}): ${excerpt(cleaned)}`,
    );
  }

  return result.data;
}

function toAtomicClaim(item: ExtractedClaim, claimId: string): AtomicClaim {
  return {
    id: `${claimId}-atomic-0`,
    proposition: item.normalizedClaim,
    ...(item.subject !== undefined ? { subject: item.subject } : {}),
    ...(item.predicate !== undefined ? { predicate: item.predicate } : {}),
    ...(item.period !== undefined ? { period: { ...item.period } } : {}),
    ...(item.populationOrScope !== undefined
      ? { populationOrScope: item.populationOrScope }
      : {}),
    ...(item.quantity !== undefined ? { quantity: { ...item.quantity } } : {}),
  };
}

/**
 * Builds contract-valid claims (status DETECTED, revision 0) from a parsed
 * extraction. Pure: ids are derived from the fingerprint and the entry index.
 */
export function toClaims(
  extracted: readonly ExtractedClaim[],
  source: ExtractionSource,
  fingerprint?: string,
): Claim[] {
  const now = new Date().toISOString();
  const runId = fingerprint ?? randomUUID();

  return extracted.map((item, index) => {
    const claimId = `claim-${runId}-${index.toString()}`;
    const claim: Claim = {
      id: claimId,
      ...(source.sessionId !== undefined
        ? { sessionId: source.sessionId }
        : {}),
      segmentIds: [...source.segmentIds],
      ...(source.speakerId !== undefined
        ? { speakerId: source.speakerId }
        : {}),
      originalQuote: item.originalQuote,
      normalizedClaim: item.normalizedClaim,
      ...(source.timestampMs !== undefined
        ? { timestampMs: { ...source.timestampMs } }
        : {}),
      status: 'DETECTED',
      notFactCheckable: item.notFactCheckable,
      atomicClaims: item.notFactCheckable ? [] : [toAtomicClaim(item, claimId)],
      revision: 0,
      createdAt: now,
      updatedAt: now,
    };
    return CLAIM_SCHEMA.parse(claim);
  });
}

export async function extractClaims({
  text,
  context,
  llm,
  source,
  fingerprint,
}: ExtractClaimsArgs): Promise<Claim[]> {
  if (text.trim().length === 0) {
    throw new ValidationError('extractClaims requires a non-empty text.');
  }
  if (source.segmentIds.length === 0) {
    throw new ValidationError(
      'extractClaims requires at least one segment id for provenance.',
    );
  }

  const messages = await EXTRACTION_PROMPT.formatMessages(
    promptValues({ text, context }),
  );
  const response = await llm.invoke(messages);
  const extracted = parseExtractionResponse(response.text);

  // Treat the speech as the source of truth for the quote. A schema-valid
  // response can still contain a quote invented or paraphrased by the model.
  const invalidQuote = extracted.find(
    (item) => !text.includes(item.originalQuote),
  );
  if (invalidQuote !== undefined) {
    throw new ValidationError(
      'A extração retornou uma citação que não aparece literalmente no trecho transcrito; a afirmação foi descartada.',
    );
  }

  return toClaims(extracted, source, fingerprint);
}
