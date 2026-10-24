import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURE_CASE_SCHEMA, type FixtureCase } from './types.js';

const HERE = dirname(fileURLToPath(import.meta.url));

export const FACTUAL_EVAL_ROOT = HERE;
export const FIXTURES_DIR = join(HERE, 'fixtures');
export const CORPUS_DIR = join(HERE, 'corpus');

export async function loadCorpusDocument(
  documentId: string,
): Promise<string> {
  const path = join(CORPUS_DIR, `${documentId}.txt`);
  return readFile(path, 'utf8');
}

export async function loadFixtureFile(path: string): Promise<FixtureCase> {
  const raw = JSON.parse(await readFile(path, 'utf8')) as unknown;
  return FIXTURE_CASE_SCHEMA.parse(raw);
}

/** Loads every `*.json` fixture under eval/factual/fixtures (frozen corpus). */
export async function loadAllFixtures(
  fixturesDir: string = FIXTURES_DIR,
): Promise<FixtureCase[]> {
  const entries = await readdir(fixturesDir);
  const files = entries.filter((name) => name.endsWith('.json')).sort();
  const fixtures: FixtureCase[] = [];
  for (const file of files) {
    fixtures.push(await loadFixtureFile(join(fixturesDir, file)));
  }
  return fixtures;
}
