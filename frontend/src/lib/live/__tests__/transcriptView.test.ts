import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Claim, SpeakerMapping, TranscriptSegment } from '@veritas/shared';

import ptBR from '../../i18n/locales/pt-BR.json';
import enUS from '../../i18n/locales/en-US.json';
import type { TranslationKeys } from '../../i18n/types';
import {
  buildTranscriptBlocks,
  hasGatingInfo,
  numberClaims,
  summarizeTranscriptGating,
} from '../transcriptView';
import LiveTranscriptView from '../../../app/live/components/LiveTranscriptView';
import LiveGatingNotice from '../../../app/live/components/LiveGatingNotice';

const AT = '2026-10-23T22:00:00-03:00';
const pt = ptBR as unknown as TranslationKeys;
const en = enUS as unknown as TranslationKeys;

const seg = (overrides: Partial<TranscriptSegment> = {}): TranscriptSegment => ({
  id: 'seg-1',
  sessionId: 's1',
  revision: 5,
  status: 'FINAL',
  text: 'Olá a todos.',
  startMs: 0,
  endMs: 1000,
  createdAt: AT,
  ...overrides,
});

const claim = (overrides: Partial<Claim> = {}): Claim => ({
  id: 'c1',
  sessionId: 's1',
  segmentIds: ['seg-1'],
  originalQuote: 'quote',
  normalizedClaim: 'Normalized claim',
  status: 'QUEUED',
  notFactCheckable: false,
  atomicClaims: [],
  revision: 1,
  createdAt: AT,
  updatedAt: AT,
  ...overrides,
});

const fixture = () => {
  const segments: TranscriptSegment[] = [
    seg({
      id: 'a',
      speakerId: 'spk-0',
      status: 'BLOCKED',
      text: 'Eu acho que 99% das dívidas foram quitadas pelos estudantes.',
      uncertaintyReasons: ['NUMBER', 'NEGATION'],
      startMs: 21000,
      endMs: 39000,
    }),
    seg({
      id: 'b',
      speakerId: 'spk-0',
      status: 'BLOCKED',
      text: 'E o reajuste foi de 33% para os professores.',
      uncertaintyReasons: ['NUMBER'],
      startMs: 39000,
      endMs: 57000,
    }),
    seg({ id: 'c', speakerId: 'spk-1', text: 'Isso não é verdade.', startMs: 60000, endMs: 62000 }),
    seg({ id: 'd', text: 'Sem diarização.', startMs: 70000, endMs: 71000, status: 'PROVISIONAL' }),
  ];
  const claims: Claim[] = [
    claim({ id: 'k2', segmentIds: ['b'], originalQuote: 'o reajuste foi de 33% para os professores' }),
    claim({ id: 'k1', segmentIds: ['a'], originalQuote: '99% das dívidas foram quitadas' }),
    claim({
      id: 'k3',
      segmentIds: ['c'],
      originalQuote: 'citação que não está no texto',
      normalizedClaim: 'A afirmação anterior é falsa.',
    }),
  ];
  return { segments, claims };
};

test('groups consecutive segments by speaker with neutral labels', () => {
  const { segments, claims } = fixture();
  const blocks = buildTranscriptBlocks(segments, claims, []);
  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks[0].heading, { kind: 'ordinal', ordinal: 1 });
  assert.equal(blocks[0].lines.length, 2);
  assert.deepEqual(blocks[1].heading, { kind: 'ordinal', ordinal: 2 });
  assert.deepEqual(blocks[2].heading, { kind: 'participant' });
});

test('confirmed mapping shows the participant name; unconfirmed never does', () => {
  const { segments, claims } = fixture();
  const mappings: SpeakerMapping[] = [
    { speakerId: 'spk-0', participantName: 'Ana', confirmed: true, revision: 1 },
    { speakerId: 'spk-1', participantName: 'Palpite', confirmed: false, revision: 1 },
  ];
  const blocks = buildTranscriptBlocks(segments, claims, mappings);
  assert.deepEqual(blocks[0].heading, { kind: 'name', name: 'Ana' });
  assert.deepEqual(blocks[1].heading, { kind: 'ordinal', ordinal: 1 });
});

test('claims are numbered in speech order and highlighted inline', () => {
  const { segments, claims } = fixture();
  const numbers = numberClaims(segments, claims);
  assert.equal(numbers.get('k1'), 1);
  assert.equal(numbers.get('k2'), 2);
  assert.equal(numbers.get('k3'), 3);

  const [first] = buildTranscriptBlocks(segments, claims, []);
  const parts = first.lines[0].parts;
  assert.deepEqual(parts.map((p) => p.type), ['text', 'claim', 'text']);
  assert.equal(parts.map((p) => p.text).join(''), segments[0].text);
  const claimPart = parts[1];
  assert.equal(claimPart.type === 'claim' && claimPart.number, 1);
});

test('claim whose quote is not verbatim is shown after its segment', () => {
  const { segments, claims } = fixture();
  const blocks = buildTranscriptBlocks(segments, claims, []);
  const line = blocks[1].lines[0];
  assert.deepEqual(line.parts, [{ type: 'text', text: 'Isso não é verdade.' }]);
  assert.deepEqual(line.trailingClaims, [
    { claimId: 'k3', number: 3, text: 'A afirmação anterior é falsa.' },
  ]);
});

test('gating summary carries what the transcript no longer shows', () => {
  const { segments } = fixture();
  const summary = summarizeTranscriptGating(segments, []);
  assert.deepEqual(summary, {
    unknownAuthorship: 2,
    blocked: 2,
    uncertainNumber: 2,
    uncertainNegation: 1,
    otherUncertain: 0,
  });
  assert.equal(hasGatingInfo(summary), true);
  assert.equal(hasGatingInfo(summarizeTranscriptGating([seg()], [])), false);
});

const ANALYSIS_TEXT = [
  'Bloqueado',
  'BLOQUEADO',
  'Autoria desconhecida',
  'Número incerto',
  'Negação incerta',
  'Rev. ',
  'Parcial',
  'Definitivo',
  'Corrigir fala</',
  '00:21',
];

test('transcript renders only speaker + speech (no analysis chips)', () => {
  const { segments, claims } = fixture();
  const html = renderToStaticMarkup(
    React.createElement(LiveTranscriptView, {
      blocks: buildTranscriptBlocks(segments, claims, []),
      strings: pt.live.transcript,
      cancelLabel: pt.common.cancel,
      canCorrect: true,
      gapCount: 2,
    }),
  );

  for (const forbidden of ANALYSIS_TEXT) {
    const visible = html.replace(/(title|aria-label)="[^"]*"/g, '');
    assert.equal(visible.includes(forbidden), false, `should not render "${forbidden}"`);
  }
  assert.ok(html.includes('Locutor 1'));
  assert.ok(html.includes('Locutor 2'));
  assert.ok(html.includes('Participante'));
  assert.ok(html.includes('99% das dívidas foram quitadas'));
  assert.ok(html.includes('id="claim-k1"'));
  assert.ok(!/#fef7f7|#fecaca|#fef2f2/.test(html), 'no pink alert backgrounds');
  // Correction stays available through an icon-only, labelled button.
  assert.equal((html.match(/data-slot="transcript-edit"/g) ?? []).length, 4);
  assert.ok(html.includes('aria-label="Corrigir fala"'));
  // Gaps only as a discreet header badge.
  assert.ok(html.includes('data-slot="transcript-gaps"'));
});

test('transcript labels are localized (en-US)', () => {
  const { segments, claims } = fixture();
  const html = renderToStaticMarkup(
    React.createElement(LiveTranscriptView, {
      blocks: buildTranscriptBlocks(segments, claims, []),
      strings: en.live.transcript,
      cancelLabel: en.common.cancel,
    }),
  );
  assert.ok(html.includes('Speaker 1'));
  assert.ok(html.includes('Participant'));
  assert.ok(!html.includes('transcript-edit'), 'no edit affordance without a session');
});

test('gating notice lists the moved info next to the verifications', () => {
  const { segments } = fixture();
  const html = renderToStaticMarkup(
    React.createElement(LiveGatingNotice, {
      summary: summarizeTranscriptGating(segments, []),
      strings: pt.live.gating,
    }),
  );
  assert.ok(html.includes('2 fala(s) sem locutor confirmado'));
  assert.ok(html.includes('2 fala(s) com número incerto'));
  assert.ok(html.includes('1 fala(s) com negação incerta'));

  const empty = renderToStaticMarkup(
    React.createElement(LiveGatingNotice, {
      summary: summarizeTranscriptGating([seg()], []),
      strings: pt.live.gating,
    }),
  );
  assert.equal(empty, '');
});
