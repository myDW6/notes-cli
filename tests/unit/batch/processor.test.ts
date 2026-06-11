import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { processJSONLBatch } from '../../../src/batch/processor.js';
import type { BatchResultOutput } from '../../../src/cli/output.js';

describe('JSONL batch processing', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'notes-batch-test-'));
  });

  it('continues after item errors and preserves physical line numbers', async () => {
    const inputPath = path.join(dataDir, 'batch.jsonl');
    await fs.writeFile(inputPath, [
      '{"operation":"create","input":{"title":"A"}}',
      '',
      '{"operation":"create","input":',
      '{"operation":"create","input":{"title":"B"}}',
    ].join('\n'));
    const results: BatchResultOutput[] = [];

    const summary = await processJSONLBatch({
      dataDir,
      inputPath,
      failFast: false,
      onResult: (result) => results.push(result),
    });

    expect(summary).toMatchObject({
      processed: 3,
      failed: 1,
      firstFailureCategory: 'usage',
    });
    expect(results).toMatchObject([
      { index: 0, line: 1, operation: 'create', ok: true },
      {
        index: 1,
        line: 3,
        ok: false,
        error: { code: 'INVALID_JSONL_LINE' },
      },
      { index: 2, line: 4, operation: 'create', ok: true },
    ]);
  });

  it('stops after the first error in fail-fast mode', async () => {
    const inputPath = path.join(dataDir, 'batch.jsonl');
    await fs.writeFile(inputPath, [
      '{"operation":"create","input":{"title":"A"}}',
      '{"operation":"delete","input":{"id":"missing"},"confirm":false}',
      '{"operation":"create","input":{"title":"C"}}',
    ].join('\n'));
    const results: BatchResultOutput[] = [];

    const summary = await processJSONLBatch({
      dataDir,
      inputPath,
      failFast: true,
      onResult: (result) => results.push(result),
    });

    expect(summary).toMatchObject({
      processed: 2,
      failed: 1,
      firstFailureCategory: 'usage',
    });
    expect(results).toHaveLength(2);
    expect(results[1]).toMatchObject({
      index: 1,
      ok: false,
      error: { code: 'CONFIRMATION_REQUIRED' },
    });
  });

  it('stops at an item boundary when the abort signal is triggered', async () => {
    const inputPath = path.join(dataDir, 'batch.jsonl');
    await fs.writeFile(inputPath, [
      '{"operation":"create","input":{"title":"A"}}',
      '{"operation":"create","input":{"title":"B"}}',
      '{"operation":"create","input":{"title":"C"}}',
    ].join('\n'));
    const controller = new AbortController();
    const results: BatchResultOutput[] = [];

    const summary = await processJSONLBatch({
      dataDir,
      inputPath,
      failFast: false,
      signal: controller.signal,
      onResult: (result) => {
        results.push(result);
        controller.abort({ kind: 'signal', signal: 'SIGINT' });
      },
    });

    expect(results).toHaveLength(1);
    expect(summary).toMatchObject({
      processed: 1,
      failed: 0,
      cancelled: { kind: 'signal', signal: 'SIGINT' },
    });
  });
});
