import { describe, expect, it } from 'vitest';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import { CLAIM_SCHEMA } from '@veritas/shared';
import { ParsingError, ValidationError } from '#/utils/errors.js';
import {
  EXTRACTED_CLAIM_SCHEMA,
  EXTRACTION_RESPONSE_SCHEMA,
  buildExtractionPrompt,
  extractClaims,
  toClaims,
} from '#/analysis/claimExtraction.js';

class FakeChatModel extends BaseChatModel {
  private readonly responses: string[];
  readonly calls: BaseMessage[][] = [];

  constructor(responses: string[]) {
    super({});
    this.responses = [...responses];
  }

  _llmType(): string {
    return 'fake-claim-extraction-model';
  }

  _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.calls.push(messages);
    const text = this.responses.shift() ?? '';
    return Promise.resolve({
      generations: [{ text, message: new AIMessage(text) }],
    });
  }
}

const SOURCE = {
  sessionId: 'session-1',
  segmentIds: ['segment-1', 'segment-2'],
  speakerId: 'speaker-a',
  timestampMs: { start: 12_000, end: 18_000 },
};

const TEXT =
  'O Pix foi criado em 2015. O auxílio de R$ 600 é temporário.';

const MULTI_CLAIM_RESPONSE = JSON.stringify([
  {
    originalQuote: 'O Pix foi criado em 2015.',
    normalizedClaim: 'O Pix foi criado em 2015.',
    notFactCheckable: false,
    subject: 'Pix',
    predicate: 'foi criado',
    period: { start: '2015' },
  },
  {
    originalQuote: 'O auxílio de R$ 600 é temporário.',
    normalizedClaim: 'O auxílio de R$ 600 é temporário.',
    quantity: { value: 600, unit: 'R$' },
    populationOrScope: 'auxílio',
  },
]);

const messageText = (message: BaseMessage): string =>
  typeof message.content === 'string'
    ? message.content
    : JSON.stringify(message.content);

describe('claimExtraction', () => {
  it('extracts one claim per atomic proposition with provenance and no verdict', async () => {
    const llm = new FakeChatModel([MULTI_CLAIM_RESPONSE]);

    const claims = await extractClaims({
      text: TEXT,
      llm,
      source: SOURCE,
      fingerprint: 'run1',
    });

    expect(claims).toHaveLength(2);
    expect(claims.map((claim) => claim.id)).toEqual([
      'claim-run1-0',
      'claim-run1-1',
    ]);

    for (const claim of claims) {
      expect(CLAIM_SCHEMA.safeParse(claim).success).toBe(true);
      expect(claim.status).toBe('DETECTED');
      expect(claim.revision).toBe(0);
      expect(claim.sessionId).toBe('session-1');
      expect(claim.segmentIds).toEqual(['segment-1', 'segment-2']);
      expect(claim.speakerId).toBe('speaker-a');
      expect(claim.timestampMs).toEqual({ start: 12_000, end: 18_000 });
      expect(claim.createdAt).toBe(claim.updatedAt);
      expect(new Date(claim.createdAt).toISOString()).toBe(claim.createdAt);
      expect(claim).not.toHaveProperty('verdict');
      expect(claim).not.toHaveProperty('conclusion');
      expect(claim.notFactCheckable).toBe(false);
      expect(claim.atomicClaims).toHaveLength(1);
    }

    expect(claims[0].originalQuote).toBe('O Pix foi criado em 2015.');
    expect(claims[0].normalizedClaim).toBe('O Pix foi criado em 2015.');
    expect(claims[0].atomicClaims[0]).toMatchObject({
      id: 'claim-run1-0-atomic-0',
      proposition: 'O Pix foi criado em 2015.',
      subject: 'Pix',
      predicate: 'foi criado',
      period: { start: '2015' },
    });

    expect(claims[1].originalQuote).toBe('O auxílio de R$ 600 é temporário.');
    expect(claims[1].atomicClaims[0].quantity).toEqual({
      value: 600,
      unit: 'R$',
    });
    expect(claims[1].atomicClaims[0].populationOrScope).toBe('auxílio');
  });

  it('triages non verifiable statements as NOT_FACT_CHECKABLE without atomic claims', async () => {
    const llm = new FakeChatModel([
      JSON.stringify([
        {
          originalQuote: 'Eu acho que o governo deveria investir mais.',
          normalizedClaim: 'Opinião sobre o investimento do governo.',
          notFactCheckable: true,
          subject: 'governo',
          quantity: { value: 1, unit: 'R$' },
        },
      ]),
    ]);

    const [claim] = await extractClaims({ text: 'Eu acho que o governo deveria investir mais.', llm, source: SOURCE });

    expect(claim.notFactCheckable).toBe(true);
    expect(claim.atomicClaims).toEqual([]);
    expect(claim.status).toBe('DETECTED');
    expect(CLAIM_SCHEMA.safeParse(claim).success).toBe(true);
  });

  it('defaults notFactCheckable to false when the model omits the flag', async () => {
    const llm = new FakeChatModel([
      JSON.stringify([
        {
          originalQuote: 'O Pix foi criado em 2020.',
          normalizedClaim: 'O Pix foi criado em 2020.',
        },
      ]),
    ]);

    const [claim] = await extractClaims({ text: 'O Pix foi criado em 2020.', llm, source: SOURCE });

    expect(claim.notFactCheckable).toBe(false);
    expect(claim.atomicClaims).toHaveLength(1);
  });

  it('rejects a schema-valid quote that is not present in the transcript', async () => {
    const llm = new FakeChatModel([
      JSON.stringify([
        {
          originalQuote: 'O total foi de 15 bilhões de reais.',
          normalizedClaim: 'O total foi de 15 bilhões de reais.',
        },
      ]),
    ]);

    await expect(
      extractClaims({ text: 'Boa noite a todos.', llm, source: SOURCE }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('accepts an empty array as a valid extraction', async () => {
    const llm = new FakeChatModel(['[]']);

    await expect(
      extractClaims({ text: 'Boa noite a todos.', llm, source: SOURCE }),
    ).resolves.toEqual([]);
  });

  it('accepts JSON wrapped in code fences', async () => {
    const llm = new FakeChatModel(['```json\n[]\n```']);

    await expect(
      extractClaims({ text: 'Boa noite a todos.', llm, source: SOURCE }),
    ).resolves.toEqual([]);
  });

  it('throws ParsingError on malformed JSON instead of fabricating claims', async () => {
    const malformed = new FakeChatModel(['{ "originalQuote": "O Pix foi criado"']);
    await expect(
      extractClaims({ text: TEXT, llm: malformed, source: SOURCE }),
    ).rejects.toBeInstanceOf(ParsingError);

    const prose = new FakeChatModel(['Não há afirmações verificáveis nesta fala.']);
    await expect(
      extractClaims({ text: TEXT, llm: prose, source: SOURCE }),
    ).rejects.toBeInstanceOf(ParsingError);

    const empty = new FakeChatModel(['']);
    await expect(
      extractClaims({ text: TEXT, llm: empty, source: SOURCE }),
    ).rejects.toBeInstanceOf(ParsingError);
  });

  it('throws ParsingError when the JSON does not follow the extraction schema', async () => {
    const missingField = new FakeChatModel([
      JSON.stringify([{ originalQuote: 'O Pix foi criado em 2015.' }]),
    ]);
    await expect(
      extractClaims({ text: TEXT, llm: missingField, source: SOURCE }),
    ).rejects.toBeInstanceOf(ParsingError);

    const wrapped = new FakeChatModel([JSON.stringify({ claims: [] })]);
    await expect(
      extractClaims({ text: TEXT, llm: wrapped, source: SOURCE }),
    ).rejects.toBeInstanceOf(ParsingError);

    const wrongTypes = new FakeChatModel([
      JSON.stringify([
        {
          originalQuote: 'O auxílio de R$ 600 é temporário.',
          normalizedClaim: 'O auxílio de R$ 600 é temporário.',
          quantity: { value: '600', unit: 'R$' },
        },
      ]),
    ]);
    await expect(
      extractClaims({ text: TEXT, llm: wrongTypes, source: SOURCE }),
    ).rejects.toBeInstanceOf(ParsingError);
  });

  it('rejects empty text and missing segment provenance', async () => {
    await expect(
      extractClaims({ text: '   ', llm: new FakeChatModel(['[]']), source: SOURCE }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      extractClaims({
        text: TEXT,
        llm: new FakeChatModel(['[]']),
        source: { segmentIds: [] },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('keeps ids stable for the same fingerprint and unique otherwise', async () => {
    const first = await extractClaims({
      text: TEXT,
      llm: new FakeChatModel([MULTI_CLAIM_RESPONSE]),
      source: SOURCE,
      fingerprint: 'stable',
    });
    const second = await extractClaims({
      text: TEXT,
      llm: new FakeChatModel([MULTI_CLAIM_RESPONSE]),
      source: SOURCE,
      fingerprint: 'stable',
    });
    const random = await extractClaims({
      text: TEXT,
      llm: new FakeChatModel([MULTI_CLAIM_RESPONSE]),
      source: SOURCE,
    });

    expect(first.map((claim) => claim.id)).toEqual(
      second.map((claim) => claim.id),
    );
    expect(random.map((claim) => claim.id)).toEqual([
      expect.stringMatching(/^claim-[0-9a-f-]{36}-0$/),
      expect.stringMatching(/^claim-[0-9a-f-]{36}-1$/),
    ]);
  });

  it('builds a prompt with the extraction rules, context and input', () => {
    const prompt = buildExtractionPrompt({
      text: 'Ele foi pago em doze parcelas.',
      context: '[00:10] candidato-b: O auxílio de R$ 600 existe.',
    });

    expect(prompt).toContain('[00:10] candidato-b: O auxílio de R$ 600 existe.');
    expect(prompt).toContain('Ele foi pago em doze parcelas.');
    expect(prompt).not.toContain('{context}');
    expect(prompt).not.toContain('{input}');
    expect(prompt).not.toContain('{{');

    expect(prompt).toContain('Never judge truth');
    expect(prompt).toContain('originalQuote must be an exact literal substring');
    expect(prompt).toContain('One entry per atomic proposition');
    expect(prompt).toContain('Never merge two speakers');
    expect(prompt).toContain('Return only valid JSON');
    expect(prompt).toContain('"originalQuote"');
    expect(prompt).toContain('"notFactCheckable"');
  });

  it('sends the rendered prompt and JSON schema to the model', async () => {
    const llm = new FakeChatModel(['[]']);

    await extractClaims({
      text: 'Segunda fala.',
      context: '[00:00] candidato-a: Primeira fala.',
      llm,
      source: SOURCE,
    });

    expect(llm.calls).toHaveLength(1);
    const sent = messageText(llm.calls[0][0]);

    expect(sent).toContain('Primeira fala.');
    expect(sent).toContain('Segunda fala.');
    expect(sent).toContain('"normalizedClaim"');
    expect(sent).not.toContain('{context}');
  });

  it('maps extracted entries to contract claims through toClaims', () => {
    const claims = toClaims(
      [
        {
          originalQuote: 'Eu acho que o governo deveria investir mais.',
          normalizedClaim: 'Opinião sobre o investimento do governo.',
          notFactCheckable: true,
        },
      ],
      { sessionId: 'session-1', segmentIds: ['segment-1'] },
      'direct',
    );

    expect(claims).toHaveLength(1);
    expect(claims[0].id).toBe('claim-direct-0');
    expect(claims[0].atomicClaims).toEqual([]);
    expect(claims[0].sessionId).toBe('session-1');
    expect(claims[0]).not.toHaveProperty('speakerId');
    expect(claims[0]).not.toHaveProperty('timestampMs');
    expect(toClaims([], { segmentIds: ['segment-1'] })).toEqual([]);
  });

  it('keeps braces from the speech out of the prompt template', async () => {
    const text = 'O valor {sic} de R$ 600 foi pago.';
    const context = '[00:00] spk-a: Fala com {chaves} no meio.';
    const llm = new FakeChatModel(['[]']);

    const prompt = buildExtractionPrompt({ text, context });
    expect(prompt).toContain(text);
    expect(prompt).toContain(context);

    await extractClaims({ text, context, llm, source: SOURCE });

    const sent = messageText(llm.calls[0][0]);
    expect(sent).toContain(text);
    expect(sent).toContain(context);
  });

  it('exposes the extraction schemas for validation', () => {
    expect(EXTRACTION_RESPONSE_SCHEMA.safeParse([]).success).toBe(true);
    expect(
      EXTRACTION_RESPONSE_SCHEMA.safeParse([{ originalQuote: 'x' }]).success,
    ).toBe(false);
    expect(
      EXTRACTED_CLAIM_SCHEMA.safeParse({
        originalQuote: 'O Pix foi criado em 2020.',
        normalizedClaim: 'O Pix foi criado em 2020.',
      }).success,
    ).toBe(true);
  });
});
