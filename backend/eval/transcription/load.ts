import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWhisperJson } from '#/live/transcription.js';
import {
  RECORDED_META_SCHEMA,
  TRANSCRIPTION_FIXTURE_SCHEMA,
  type TranscriptionFixture,
} from './types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const TRANSCRIPTION_FIXTURES_DIR = join(HERE, 'fixtures');

export async function loadTranscriptionFixtures(
  dir: string = TRANSCRIPTION_FIXTURES_DIR,
): Promise<TranscriptionFixture[]> {
  const files = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort();
  const fixtures: TranscriptionFixture[] = [];
  for (const file of files) {
    const raw = JSON.parse(await readFile(join(dir, file), 'utf8')) as unknown;
    fixtures.push(TRANSCRIPTION_FIXTURE_SCHEMA.parse(raw));
  }
  return fixtures;
}

/**
 * Replaces simulated hypotheses with real `whisper-cli -oj` outputs recorded
 * on the LIVE-000 machine: `<dir>/<fixtureId>.json` plus a mandatory
 * `<dir>/<fixtureId>.meta.json` ({ model, hardware, processingMs?, mediaKind? }).
 * Fixtures without a recorded output keep their simulated hypothesis.
 */
export async function applyRecordedHypotheses(
  fixtures: readonly TranscriptionFixture[],
  dir: string,
): Promise<TranscriptionFixture[]> {
  const result: TranscriptionFixture[] = [];
  for (const fixture of fixtures) {
    const outputPath = join(dir, `${fixture.id}.json`);
    if (!existsSync(outputPath)) {
      result.push(fixture);
      continue;
    }
    const metaPath = join(dir, `${fixture.id}.meta.json`);
    if (!existsSync(metaPath)) {
      throw new Error(
        `Hipótese gravada ${outputPath} sem ${fixture.id}.meta.json (modelo/hardware são obrigatórios).`,
      );
    }
    const parsed = parseWhisperJson(await readFile(outputPath, 'utf8'));
    const meta = RECORDED_META_SCHEMA.parse(
      JSON.parse(await readFile(metaPath, 'utf8')) as unknown,
    );
    result.push({
      ...fixture,
      media: {
        ...fixture.media,
        kind: meta.mediaKind ?? fixture.media.kind,
      },
      hypothesis: {
        provenance: 'RECORDED',
        text: parsed.text,
        model: meta.model,
        hardware: meta.hardware,
        ...(meta.processingMs !== undefined
          ? { processingMs: meta.processingMs }
          : {}),
      },
    });
  }
  return result;
}
