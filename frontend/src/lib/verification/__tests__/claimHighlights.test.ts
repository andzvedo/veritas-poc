import assert from 'node:assert/strict';
import test from 'node:test';
import { findClaimHighlights } from '../claimHighlights.js';

const claim = (id: string, text: string) => ({ id, text });

test('assigns repeated quotes to separate occurrences without overlaps', () => {
  const text = 'O PIB cresceu. O PIB cresceu.';
  const matches = findClaimHighlights(text, [claim('a', 'O PIB cresceu.'), claim('b', 'O PIB cresceu.')]);
  assert.deepEqual(matches.map(({ startIndex, endIndex }) => [startIndex, endIndex]), [[0, 14], [15, 29]]);
});

test('normalized matches keep original punctuation, whitespace and offsets', () => {
  const text = 'Antes: em 2020,\n  o PIB caiu 4,1%. Depois.';
  const matches = findClaimHighlights(text, [claim('a', 'Em 2020 o PIB caiu 4,1%')]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].text, 'em 2020,\n  o PIB caiu 4,1%');
  const { startIndex, endIndex } = matches[0];
  assert.equal(text.slice(startIndex, endIndex), matches[0].text);
  assert.equal(text.slice(0, startIndex) + matches[0].text + text.slice(endIndex), text);
});

test('finds a later normalized occurrence when the first is already assigned', () => {
  const matches = findClaimHighlights('PIB, cresceu. PIB, cresceu.', [claim('a', 'pib cresceu'), claim('b', 'pib cresceu')]);
  assert.equal(matches.length, 2);
  assert.ok(matches[1].startIndex >= matches[0].endIndex);
});

test('rejects nested matches, blank quotes and absent claims', () => {
  const matches = findClaimHighlights('O PIB cresceu.', [
    claim('a', 'O PIB cresceu.'), claim('b', 'PIB'), claim('c', '""'), claim('d', '...'), claim('e', 'inexistente'),
  ]);
  assert.deepEqual(matches.map(({ id }) => id), ['a']);
});

test('never highlights a different statement based only on a matching prefix', () => {
  const prefix = 'Uma afirmação muito longa que tem mais de trinta caracteres';
  assert.deepEqual(findClaimHighlights(prefix + ' mas é falsa.', [claim('a', prefix + ' e é verdadeira.')]), []);
});

test('keeps result numbers when sorting matches by text position', () => {
  const matches = findClaimHighlights('Primeira. Segunda.', [claim('second', 'Segunda.'), claim('first', 'Primeira.')]);
  assert.deepEqual(matches.map(({ id, number }) => [id, number]), [['first', 2], ['second', 1]]);
});

test('numeric punctuation never turns a different number into a matching quote', () => {
  assert.deepEqual(findClaimHighlights('O PIB caiu 4,1%.', [claim('a', 'O PIB caiu 41%')]), []);
  assert.deepEqual(findClaimHighlights('Custa 1.000 reais.', [claim('a', 'Custa 1000 reais')]), []);
});
