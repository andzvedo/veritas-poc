import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ChunkFlowController,
  GAP_REASON_RETRIES_EXHAUSTED,
  type ChunkDescriptor,
} from '../flowControl';

const CHUNK_SAMPLES = 1600; // 100 ms @ 16 kHz

function fill(
  controller: ChunkFlowController,
  count: number,
  samples = CHUNK_SAMPLES,
): ChunkDescriptor[] {
  const chunks: ChunkDescriptor[] = [];

  for (let index = 0; index < count; index += 1) {
    const chunk = controller.beginChunk(samples);
    assert.notEqual(chunk, null, `chunk ${index} deveria caber na janela`);
    chunks.push(chunk as ChunkDescriptor);
  }

  return chunks;
}

test('ChunkFlowController: envia chunks sequenciais com relógio de amostras', () => {
  const controller = new ChunkFlowController();
  const chunks = fill(controller, 3);

  assert.deepEqual(
    chunks.map((chunk) => chunk.chunkSeq),
    [0, 1, 2],
  );
  assert.deepEqual(
    chunks.map((chunk) => chunk.startSample),
    [0, 1600, 3200],
  );
  assert.deepEqual(
    chunks.map((chunk) => chunk.samples),
    [1600, 1600, 1600],
  );
  assert.equal(controller.nextChunkSeq, 3);
  assert.equal(controller.startSample, 4800);
  assert.equal(controller.inFlightCount, 3);
});

test('ChunkFlowController: satura em maxInFlight e não cresce a fila', () => {
  const controller = new ChunkFlowController({ maxInFlight: 2 });
  const chunks = fill(controller, 2);
  const startSampleBefore = controller.startSample;

  assert.equal(controller.beginChunk(CHUNK_SAMPLES), null);
  assert.equal(controller.hasCapacity, false);
  assert.equal(controller.inFlightCount, 2);
  assert.equal(controller.nextChunkSeq, 2, 'chunk rejeitado não consome sequência');
  assert.equal(
    controller.startSample,
    startSampleBefore,
    'chunk rejeitado não avança o relógio (o chamador decide o gap)',
  );
  assert.equal(chunks.length, 2);
});

test('ChunkFlowController: ACK libera uma vaga', () => {
  const controller = new ChunkFlowController({ maxInFlight: 2 });
  const [first] = fill(controller, 2);

  assert.equal(controller.ack(first.chunkSeq), true);
  assert.equal(controller.ack(first.chunkSeq), false, 'ACK repetido é ignorado');
  assert.equal(controller.inFlightCount, 1);
  assert.equal(controller.hasCapacity, true);

  const next = controller.beginChunk(CHUNK_SAMPLES);

  assert.equal(next?.chunkSeq, 2);
  assert.equal(next?.startSample, 3200);
  assert.equal(controller.ackedCount, 1);
});

test('ChunkFlowController: retry reutiliza o MESMO chunkSeq', () => {
  const controller = new ChunkFlowController({ maxRetries: 2 });
  const [chunk] = fill(controller, 1);

  const firstFailure = controller.fail(chunk.chunkSeq);

  assert.equal(firstFailure.action, 'retry');
  assert.equal(firstFailure.chunk?.chunkSeq, chunk.chunkSeq);
  assert.equal(firstFailure.chunk?.startSample, chunk.startSample);
  assert.equal(firstFailure.attempts, 1);
  assert.equal(controller.inFlightCount, 1, 'retry mantém o slot reservado');

  const secondFailure = controller.fail(chunk.chunkSeq);

  assert.equal(secondFailure.action, 'retry');
  assert.equal(secondFailure.chunk?.chunkSeq, chunk.chunkSeq);
  assert.equal(secondFailure.gap, null);
  assert.equal(controller.getGap().hasGap, false);
});

test('ChunkFlowController: dropa após maxRetries e cria lacuna explícita', () => {
  const controller = new ChunkFlowController({ maxRetries: 2 });
  const [chunk] = fill(controller, 1);

  controller.fail(chunk.chunkSeq);
  controller.fail(chunk.chunkSeq);

  const dropped = controller.fail(chunk.chunkSeq);

  assert.equal(dropped.action, 'dropped');
  assert.equal(dropped.attempts, 3);
  assert.equal(dropped.chunk?.chunkSeq, 0);
  assert.equal(controller.inFlightCount, 0);
  assert.equal(controller.droppedCount, 1);

  const gap = controller.getGap();

  assert.equal(gap.hasGap, true);
  assert.equal(gap.totalSamples, CHUNK_SAMPLES);
  assert.equal(gap.ranges.length, 1);
  assert.equal(gap.ranges[0].fromSample, 0);
  assert.equal(gap.ranges[0].toSample, CHUNK_SAMPLES);
  assert.equal(gap.ranges[0].reason, GAP_REASON_RETRIES_EXHAUSTED);
  assert.deepEqual(gap.ranges[0].chunkSeqs, [0]);
  assert.deepEqual(dropped.gap?.chunkSeqs, [0]);
});

test('ChunkFlowController: maxRetries = 0 dropa na primeira falha', () => {
  const controller = new ChunkFlowController({ maxRetries: 0 });
  const [chunk] = fill(controller, 1);

  const result = controller.fail(chunk.chunkSeq);

  assert.equal(result.action, 'dropped');
  assert.equal(controller.getGap().totalSamples, CHUNK_SAMPLES);
});

test('ChunkFlowController: falha de chunk desconhecido é ignorada', () => {
  const controller = new ChunkFlowController();
  fill(controller, 1);
  controller.ack(0);

  const result = controller.fail(0);

  assert.equal(result.action, 'ignored');
  assert.equal(result.chunk, null);
  assert.equal(controller.getGap().hasGap, false);
});

test('ChunkFlowController: startSample continua após descarte (sem compactar)', () => {
  const controller = new ChunkFlowController();
  const [first] = fill(controller, 1);

  controller.fail(first.chunkSeq);
  controller.fail(first.chunkSeq);
  controller.fail(first.chunkSeq);
  const dropped = controller.fail(first.chunkSeq);

  assert.equal(dropped.action, 'dropped');

  const next = controller.beginChunk(CHUNK_SAMPLES);

  assert.equal(next?.chunkSeq, 1);
  assert.equal(
    next?.startSample,
    CHUNK_SAMPLES,
    'a amostra descartada continua ocupando a linha do tempo',
  );
  assert.equal(controller.startSample, CHUNK_SAMPLES * 2);
});

test('ChunkFlowController: registerGap avança o relógio (saturação)', () => {
  const controller = new ChunkFlowController();
  fill(controller, 1);

  const [gap] = controller.registerGap('saturated', 3200);

  assert.equal(gap.fromSample, 1600);
  assert.equal(gap.toSample, 4800);
  assert.equal(gap.reason, 'saturated');
  assert.deepEqual(gap.chunkSeqs, []);
  assert.equal(controller.startSample, 4800);

  const next = controller.beginChunk(CHUNK_SAMPLES);

  assert.equal(next?.startSample, 4800);
});

test('ChunkFlowController: registerGap sem argumentos reporta os unacked', () => {
  const controller = new ChunkFlowController();
  fill(controller, 3);
  controller.ack(1);

  const gaps = controller.registerGap('unacked');

  assert.equal(gaps.length, 2, 'ranges não contíguos não são fundidos');
  assert.deepEqual(gaps[0].chunkSeqs, [0]);
  assert.deepEqual([gaps[0].fromSample, gaps[0].toSample], [0, 1600]);
  assert.deepEqual(gaps[1].chunkSeqs, [2]);
  assert.deepEqual([gaps[1].fromSample, gaps[1].toSample], [3200, 4800]);
  assert.equal(gaps[0].reason, 'unacked');
  assert.equal(controller.inFlightCount, 0);
  assert.equal(controller.getGap().totalSamples, 3200);
});

test('ChunkFlowController: registerGap sem unacked não cria lacuna', () => {
  const controller = new ChunkFlowController();

  assert.deepEqual(controller.registerGap('unacked'), []);
  assert.equal(controller.getGap().hasGap, false);
});

test('ChunkFlowController: flushPending devolve e limpa os pendentes', () => {
  const controller = new ChunkFlowController();
  fill(controller, 3);
  controller.ack(0);

  const pending = controller.flushPending();

  assert.deepEqual(
    pending.map((chunk) => chunk.chunkSeq),
    [1, 2],
  );
  assert.equal(controller.inFlightCount, 0);
  assert.deepEqual(controller.getGap().unacked, []);
});

test('ChunkFlowController: getGap expõe unacked sem marcar perda confirmada', () => {
  const controller = new ChunkFlowController();
  fill(controller, 2);

  const gap = controller.getGap();

  assert.equal(gap.hasGap, false, 'unacked é potencial, não perda confirmada');
  assert.deepEqual(
    gap.unacked.map((chunk) => chunk.chunkSeq),
    [0, 1],
  );
});

test('ChunkFlowController: coalesce lacunas contíguas com a mesma razão', () => {
  const controller = new ChunkFlowController();
  controller.registerGap('saturated', 1600);
  controller.registerGap('saturated', 1600);

  const gap = controller.getGap();

  assert.equal(gap.ranges.length, 1);
  assert.equal(gap.ranges[0].fromSample, 0);
  assert.equal(gap.ranges[0].toSample, 3200);
  assert.equal(gap.totalSamples, 3200);
});

test('ChunkFlowController: limita o número de lacunas retidas sem perder a conta', () => {
  const controller = new ChunkFlowController({ maxGapRanges: 2 });
  controller.registerGap('a', 100);
  controller.registerGap('b', 100);
  controller.registerGap('c', 100);

  const gap = controller.getGap();

  assert.equal(gap.ranges.length, 2);
  assert.equal(gap.compactedRanges, 1);
  assert.equal(gap.compactedSamples, 100);
  assert.equal(gap.totalSamples, 300);
  assert.equal(gap.hasGap, true);
});

test('ChunkFlowController: reset limpa fila, relógio e lacunas', () => {
  const controller = new ChunkFlowController();
  fill(controller, 2);
  controller.fail(0);
  controller.fail(0);
  controller.fail(0);
  controller.fail(0);

  controller.reset();

  assert.equal(controller.nextChunkSeq, 0);
  assert.equal(controller.startSample, 0);
  assert.equal(controller.inFlightCount, 0);
  assert.equal(controller.getGap().hasGap, false);
  assert.deepEqual(controller.getGap().ranges, []);

  const chunk = controller.beginChunk(CHUNK_SAMPLES);

  assert.equal(chunk?.chunkSeq, 0);
  assert.equal(chunk?.startSample, 0);
});

test('ChunkFlowController: valida opções e amostras', () => {
  assert.throws(() => new ChunkFlowController({ maxInFlight: 0 }), RangeError);
  assert.throws(() => new ChunkFlowController({ maxRetries: -1 }), RangeError);

  const controller = new ChunkFlowController();

  assert.throws(() => controller.beginChunk(0), RangeError);
  assert.throws(() => controller.beginChunk(-1600), RangeError);
  assert.throws(() => controller.beginChunk(1.5), RangeError);
  assert.throws(() => controller.registerGap('saturated', 0), RangeError);
});

test('ChunkFlowController: drop() libera a vaga sem retry e cria lacuna com o motivo', () => {
  const controller = new ChunkFlowController({ maxInFlight: 2, maxRetries: 3 });
  const [first] = fill(controller, 2);
  assert.equal(controller.hasCapacity, false);

  const result = controller.drop(first.chunkSeq, 'not_listening');

  assert.equal(result.action, 'dropped');
  assert.equal(controller.hasCapacity, true);
  assert.equal(controller.droppedCount, 1);
  assert.deepEqual(result.gap, {
    fromSample: 0,
    toSample: CHUNK_SAMPLES,
    samples: CHUNK_SAMPLES,
    reason: 'not_listening',
    chunkSeqs: [first.chunkSeq],
  });
  // A late ACK / second drop for the same chunk is ignored.
  assert.equal(controller.ack(first.chunkSeq), false);
  assert.equal(controller.drop(first.chunkSeq, 'not_listening').action, 'ignored');
});
