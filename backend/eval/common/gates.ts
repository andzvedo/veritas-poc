/**
 * Shared helpers for the offline evaluation harnesses (LIVE-033/034/035).
 *
 * Every metric is a {@link Ratio} with an explicit numerator and denominator —
 * never a bare percentage. Gates compare a ratio against a threshold and a
 * minimum sample size; a gate without enough samples never "passes".
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Ratio = {
  numerator: number;
  denominator: number;
  /** `null` when the denominator is zero (no sample, not 0% nor 100%). */
  rate: number | null;
};

export function ratio(numerator: number, denominator: number): Ratio {
  return {
    numerator,
    denominator,
    rate: denominator === 0 ? null : numerator / denominator,
  };
}

export function formatRatio(value: Ratio, digits = 1): string {
  const pct =
    value.rate === null ? 'n/a' : `${(value.rate * 100).toFixed(digits)}%`;
  return `${String(value.numerator)}/${String(value.denominator)} (${pct})`;
}

export type GateStatus = 'PASS' | 'FAIL' | 'INSUFFICIENT_SAMPLE';

export type GateDefinition = {
  id: string;
  description: string;
  comparator: '>=' | '<=';
  threshold: number;
  /** Minimum denominator for the gate to be decidable. */
  minSamples: number;
  /**
   * Blocking gates fail the eval command (exit 1). Readiness gates are
   * reported but only decide whether a capability may be declared ready.
   */
  kind: 'BLOCKING' | 'READINESS';
};

export type GateResult = GateDefinition & {
  value: Ratio;
  status: GateStatus;
};

export function evaluateGate(
  definition: GateDefinition,
  value: Ratio,
): GateResult {
  let status: GateStatus;
  if (value.denominator < definition.minSamples || value.rate === null) {
    status = 'INSUFFICIENT_SAMPLE';
  } else if (definition.comparator === '>=') {
    status = value.rate >= definition.threshold ? 'PASS' : 'FAIL';
  } else {
    status = value.rate <= definition.threshold ? 'PASS' : 'FAIL';
  }
  return { ...definition, value, status };
}

/** A blocking gate only counts as passed when its status is PASS. */
export function blockingFailures(gates: readonly GateResult[]): GateResult[] {
  return gates.filter(
    (gate) => gate.kind === 'BLOCKING' && gate.status !== 'PASS',
  );
}

export function formatGate(gate: GateResult): string {
  const threshold = `${gate.comparator} ${(gate.threshold * 100).toFixed(1)}%`;
  return `[${gate.status}] (${gate.kind}) ${gate.id}: ${formatRatio(gate.value)} — meta ${threshold}, mínimo ${String(gate.minSamples)} amostra(s) — ${gate.description}`;
}

export type SelfCheck = { name: string; ok: boolean; detail?: string };

export function selfCheck(
  name: string,
  ok: boolean,
  detail?: string,
): SelfCheck {
  return detail === undefined ? { name, ok } : { name, ok, detail };
}

export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? null;
}

/** True only when `moduleUrl` (pass `import.meta.url`) is the process entrypoint. */
export function isEntrypoint(moduleUrl: string): boolean {
  const entry = process.argv.at(1);
  if (entry === undefined) {
    return false;
  }
  return resolve(fileURLToPath(moduleUrl)) === resolve(entry);
}
