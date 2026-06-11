import fs from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { CLIError, isCLIError } from '../cli/errors.js';
import type { CancellationReason } from '../cli/cancellation.js';
import { normalizeIdempotencyKey } from '../notes/idempotency.js';
import { createNote, createNoteIdempotent, deleteNote } from '../notes/storage.js';
import { validateCreateInput } from '../protocol/discovery.js';
import type { BatchResultOutput } from '../cli/output.js';
import type { ErrorCategory } from '../cli/errors.js';

export interface BatchProcessOptions {
  dataDir: string;
  inputPath: string;
  failFast: boolean;
  signal?: AbortSignal;
  onResult: (result: BatchResultOutput) => void;
}

export interface BatchProcessSummary {
  processed: number;
  failed: number;
  firstFailureCategory?: ErrorCategory;
  cancelled?: CancellationReason;
}

interface BatchItem {
  operation: 'create' | 'delete';
  input: unknown;
  idempotencyKey?: string;
  confirm?: boolean;
}

async function* readLines(
  inputPath: string,
  signal?: AbortSignal,
): AsyncGenerator<{ line: number; text: string }> {
  if (signal?.aborted) return;
  let input: NodeJS.ReadableStream;
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;

  if (inputPath === '-') {
    input = process.stdin;
  } else {
    try {
      handle = await fs.open(inputPath, 'r');
      input = handle.createReadStream({ encoding: 'utf-8', autoClose: false });
    } catch (err) {
      throw new CLIError(
        'usage',
        'INPUT_READ_ERROR',
        `Failed to read JSONL input: ${(err as Error).message}`,
        '',
        [],
        { path: inputPath },
      );
    }
  }

  const reader = createInterface({ input, crlfDelay: Infinity });
  const closeOnAbort = () => reader.close();
  signal?.addEventListener('abort', closeOnAbort, { once: true });
  let line = 0;
  try {
    for await (const text of reader) {
      if (signal?.aborted) break;
      line += 1;
      yield { line, text };
    }
  } finally {
    signal?.removeEventListener('abort', closeOnAbort);
    reader.close();
    await handle?.close().catch(() => undefined);
  }
}

function validateBatchItem(value: unknown): BatchItem {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CLIError(
      'usage',
      'INVALID_BATCH_ITEM',
      'Batch item must be a JSON object',
      '',
      [],
      { expected: 'object' },
    );
  }

  const record = value as Record<string, unknown>;
  const operation = record.operation;
  if (operation !== 'create' && operation !== 'delete') {
    throw new CLIError(
      'usage',
      'UNSUPPORTED_BATCH_OPERATION',
      'Batch operation must be create or delete',
      '',
      [],
      { operation, supportedOperations: ['create', 'delete'] },
    );
  }

  const allowedFields = operation === 'create'
    ? ['operation', 'input', 'idempotencyKey']
    : ['operation', 'input', 'confirm'];
  const unknownField = Object.keys(record).find((field) => !allowedFields.includes(field));
  if (unknownField) {
    throw new CLIError(
      'usage',
      'UNKNOWN_BATCH_FIELD',
      `Unknown ${operation} batch field "${unknownField}"`,
      '',
      [],
      { field: unknownField, operation, allowedFields },
    );
  }
  if (
    operation === 'create' &&
    record.idempotencyKey !== undefined &&
    typeof record.idempotencyKey !== 'string'
  ) {
    throw new CLIError(
      'usage',
      'INVALID_BATCH_ITEM',
      'create idempotencyKey must be a string',
      '',
      [],
      { field: 'idempotencyKey', expected: 'string' },
    );
  }

  return {
    operation,
    input: record.input,
    idempotencyKey:
      typeof record.idempotencyKey === 'string'
        ? normalizeIdempotencyKey(record.idempotencyKey)
        : undefined,
    confirm: record.confirm === true,
  };
}

function validateDeleteInput(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CLIError(
      'usage',
      'INVALID_BATCH_ITEM',
      'Delete input must be an object',
      '',
      [],
      { operation: 'delete', expected: 'object' },
    );
  }

  const record = value as Record<string, unknown>;
  const unknownField = Object.keys(record).find((field) => field !== 'id');
  if (unknownField) {
    throw new CLIError(
      'usage',
      'UNKNOWN_INPUT_FIELD',
      `Unknown delete input field "${unknownField}"`,
      '',
      [],
      { field: unknownField, allowedFields: ['id'] },
    );
  }
  if (typeof record.id !== 'string' || record.id.trim() === '') {
    throw new CLIError(
      'usage',
      'MISSING_REQUIRED_INPUT',
      'delete input requires id',
      '',
      [],
      { field: 'id', operation: 'delete' },
    );
  }
  return record.id.trim();
}

async function executeBatchItem(dataDir: string, item: BatchItem): Promise<unknown> {
  if (item.operation === 'create') {
    const request = validateCreateInput(item.input);
    if (item.idempotencyKey) {
      const result = await createNoteIdempotent(dataDir, request, item.idempotencyKey);
      return { ...result.note, idempotency: result.idempotency };
    }
    return createNote(dataDir, request);
  }

  if (!item.confirm) {
    throw new CLIError(
      'usage',
      'CONFIRMATION_REQUIRED',
      'Batch delete requires confirm=true',
      '',
      [],
      { operation: 'delete' },
    );
  }
  const id = validateDeleteInput(item.input);
  await deleteNote(dataDir, id);
  return { deleted: true, id };
}

function itemError(err: unknown): CLIError {
  return isCLIError(err)
    ? err
    : new CLIError('internal', 'INTERNAL', (err as Error).message);
}

export async function processJSONLBatch(
  options: BatchProcessOptions,
): Promise<BatchProcessSummary> {
  let index = 0;
  let failed = 0;
  let firstFailureCategory: ErrorCategory | undefined;

  for await (const source of readLines(options.inputPath, options.signal)) {
    if (options.signal?.aborted) break;
    if (source.text.trim() === '') continue;

    let operation: string | undefined;
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(source.text) as unknown;
      } catch {
        throw new CLIError(
          'usage',
          'INVALID_JSONL_LINE',
          `Line ${source.line} is not valid JSON`,
          '',
          [],
          { line: source.line },
        );
      }

      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const candidate = (parsed as Record<string, unknown>).operation;
        if (typeof candidate === 'string') operation = candidate;
      }
      const item = validateBatchItem(parsed);
      operation = item.operation;
      const data = await executeBatchItem(options.dataDir, item);
      options.onResult({
        index,
        line: source.line,
        operation,
        ok: true,
        data,
      });
    } catch (err) {
      const cliError = itemError(err);
      failed += 1;
      firstFailureCategory ??= cliError.category;
      options.onResult({
        index,
        line: source.line,
        operation,
        ok: false,
        error: cliError.toJSON().error,
      });
      index += 1;
      if (options.failFast) break;
      continue;
    }

    index += 1;
    if (options.signal?.aborted) break;
  }

  return {
    processed: index,
    failed,
    firstFailureCategory,
    cancelled: options.signal?.aborted
      ? options.signal.reason as CancellationReason
      : undefined,
  };
}
