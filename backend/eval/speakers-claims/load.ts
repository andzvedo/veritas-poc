import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIALOGUE_FIXTURE_SCHEMA, type DialogueFixture } from './types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DIALOGUE_FIXTURES_DIR = join(HERE, 'fixtures');

export async function loadDialogueFixtures(
  dir: string = DIALOGUE_FIXTURES_DIR,
): Promise<DialogueFixture[]> {
  const files = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort();
  const fixtures: DialogueFixture[] = [];
  for (const file of files) {
    const raw = JSON.parse(await readFile(join(dir, file), 'utf8')) as unknown;
    const fixture = DIALOGUE_FIXTURE_SCHEMA.parse(raw);
    validateFixture(fixture);
    fixtures.push(fixture);
  }
  return fixtures;
}

/** Referential integrity of an annotated dialogue (fails loudly). */
export function validateFixture(fixture: DialogueFixture): void {
  const refs = new Set(fixture.participants.map((item) => item.ref));
  const segments = new Map(fixture.segments.map((item) => [item.id, item]));
  const gold = new Set(fixture.goldClaims.map((item) => item.id));
  const fail = (message: string): never => {
    throw new Error(`Fixture ${fixture.id}: ${message}`);
  };
  for (const segment of fixture.segments) {
    if (segment.refSpeaker !== null && !refs.has(segment.refSpeaker)) {
      fail(`segmento ${segment.id} com locutor desconhecido ${segment.refSpeaker}`);
    }
  }
  for (const claim of fixture.goldClaims) {
    const segment = segments.get(claim.segmentId);
    if (segment === undefined) {
      fail(`claim ${claim.id} aponta para segmento inexistente`);
      return;
    }
    if (!segment.text.includes(claim.quote)) {
      fail(`claim ${claim.id}: trecho não é literal do segmento ${segment.id}`);
    }
    if (claim.duplicateOf !== undefined && !gold.has(claim.duplicateOf)) {
      fail(`claim ${claim.id} duplica claim inexistente ${claim.duplicateOf}`);
    }
    for (const id of claim.requiresContextSegmentIds) {
      if (!segments.has(id)) {
        fail(`claim ${claim.id} requer contexto inexistente ${id}`);
      }
    }
  }
  for (const entry of fixture.mapping) {
    if (!refs.has(entry.participantRef)) {
      fail(`mapeamento para participante desconhecido ${entry.participantRef}`);
    }
  }
}
