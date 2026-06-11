import { describe, expect, it } from 'vitest';
import { CLIError } from '../../../src/cli/errors.js';
import {
  backoffDelayMs,
  executeWithRetry,
  sleepWithSignal,
} from '../../../src/cli/retry.js';
import type { LogFields, LogLevel, Logger } from '../../../src/cli/logger.js';

function memoryLogger(): Logger & {
  records: Array<{ level: LogLevel; event: string; fields?: LogFields }>;
} {
  const records: Array<{ level: LogLevel; event: string; fields?: LogFields }> = [];
  return {
    records,
    log(level, event, fields): void {
      records.push({ level, event, fields });
    },
    close(): void {},
  };
}

const policy = {
  maxRetries: 2,
  baseDelayMs: 200,
  maxDelayMs: 5_000,
};

describe('retry execution', () => {
  it('retries retryable failures with bounded exponential backoff', async () => {
    const logger = memoryLogger();
    const delays: number[] = [];
    let attempts = 0;

    const result = await executeWithRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new CLIError('internal', 'TEMPORARY_IO_FAILURE', 'temporary');
        }
        return 'ok';
      },
      policy,
      {
        signal: new AbortController().signal,
        logger,
        idempotent: true,
        random: () => 0.5,
        sleep: async (delayMs) => {
          delays.push(delayMs);
        },
      },
    );

    expect(result).toBe('ok');
    expect(attempts).toBe(3);
    expect(delays).toEqual([200, 400]);
    expect(logger.records.map(({ event }) => event)).toEqual([
      'retry.scheduled',
      'retry.started',
      'retry.scheduled',
      'retry.started',
    ]);
    expect(logger.records[0].fields).toMatchObject({
      attempt: 2,
      maxAttempts: 3,
      delayMs: 200,
      source: 'backoff',
      errorCode: 'TEMPORARY_IO_FAILURE',
    });
  });

  it('uses retryAfterMs before local backoff', async () => {
    const logger = memoryLogger();
    const delays: number[] = [];
    let attempts = 0;

    await executeWithRetry(
      async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new CLIError(
            'internal',
            'TEMPORARY_IO_FAILURE',
            'temporary',
            '',
            [],
            { retryAfterMs: 1_250 },
          );
        }
      },
      { ...policy, maxRetries: 1 },
      {
        signal: new AbortController().signal,
        logger,
        idempotent: true,
        sleep: async (delayMs) => {
          delays.push(delayMs);
        },
      },
    );

    expect(delays).toEqual([1_250]);
    expect(logger.records[0].fields).toMatchObject({
      delayMs: 1_250,
      source: 'retryAfter',
    });
  });

  it('does not retry non-retryable failures', async () => {
    let attempts = 0;
    await expect(executeWithRetry(
      async () => {
        attempts += 1;
        throw new CLIError('usage', 'INVALID_ARGUMENT', 'invalid');
      },
      policy,
      {
        signal: new AbortController().signal,
        logger: memoryLogger(),
        idempotent: true,
      },
    )).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });

    expect(attempts).toBe(1);
  });

  it('rejects automatic retry for non-idempotent operations before execution', async () => {
    let executed = false;
    await expect(executeWithRetry(
      async () => {
        executed = true;
      },
      policy,
      {
        signal: new AbortController().signal,
        logger: memoryLogger(),
        idempotent: false,
      },
    )).rejects.toMatchObject({ code: 'UNSAFE_RETRY' });

    expect(executed).toBe(false);
  });

  it('cancels while waiting without resetting the total timeout budget', async () => {
    const controller = new AbortController();
    let attempts = 0;

    await expect(executeWithRetry(
      async () => {
        attempts += 1;
        throw new CLIError('internal', 'TEMPORARY_IO_FAILURE', 'temporary');
      },
      policy,
      {
        signal: controller.signal,
        logger: memoryLogger(),
        idempotent: true,
        sleep: async (delayMs, signal) => {
          controller.abort({ kind: 'timeout', timeoutMs: 10 });
          await sleepWithSignal(delayMs, signal);
        },
      },
    )).rejects.toMatchObject({ code: 'OPERATION_TIMEOUT' });

    expect(attempts).toBe(1);
  });

  it('does not schedule another retry after the shared signal aborts', async () => {
    const controller = new AbortController();
    const logger = memoryLogger();

    await expect(executeWithRetry(
      async () => {
        controller.abort({ kind: 'timeout', timeoutMs: 10 });
        throw new CLIError('internal', 'OPERATION_TIMEOUT', 'timed out');
      },
      policy,
      {
        signal: controller.signal,
        logger,
        idempotent: true,
      },
    )).rejects.toMatchObject({ code: 'OPERATION_TIMEOUT' });

    expect(logger.records).toEqual([]);
  });

  it('caps jittered backoff at the configured maximum', () => {
    expect(backoffDelayMs(
      10,
      { maxRetries: 10, baseDelayMs: 200, maxDelayMs: 5_000 },
      () => 1,
    )).toBe(5_000);
  });
});
