import { cancellationError } from './cancellation.js';
import { CLIError, isCLIError } from './errors.js';
import type { CancellationReason } from './cancellation.js';
import type { Logger } from './logger.js';

export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface RetryExecutionOptions {
  signal: AbortSignal;
  logger: Logger;
  idempotent: boolean;
  random?: () => number;
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 0,
  baseDelayMs: 200,
  maxDelayMs: 5_000,
};

function retryAfterMs(error: CLIError): number | undefined {
  const value = error.details?.retryAfterMs;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

export function backoffDelayMs(
  retryNumber: number,
  policy: RetryPolicy,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(
    policy.baseDelayMs * (2 ** (retryNumber - 1)),
    policy.maxDelayMs,
  );
  const jitterMultiplier = 0.5 + random();
  return Math.min(
    Math.round(exponential * jitterMultiplier),
    policy.maxDelayMs,
  );
}

export function assertRetrySafe(
  policy: RetryPolicy,
  idempotent: boolean,
): void {
  if (policy.maxRetries > 0 && !idempotent) {
    throw new CLIError(
      'usage',
      'UNSAFE_RETRY',
      'Automatic retries require an idempotent operation',
      'Disable --max-retries or use an idempotency mechanism supported by the command.',
      [],
      { maxRetries: policy.maxRetries },
    );
  }
}

export function sleepWithSignal(
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(
      cancellationError(signal.reason as CancellationReason | undefined),
    );
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(cancellationError(signal.reason as CancellationReason | undefined));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function executeWithRetry<T>(
  operation: () => Promise<T>,
  policy: RetryPolicy,
  options: RetryExecutionOptions,
): Promise<T> {
  assertRetrySafe(policy, options.idempotent);

  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? sleepWithSignal;
  let attempt = 1;

  while (true) {
    if (options.signal.aborted) {
      throw cancellationError(
        options.signal.reason as CancellationReason | undefined,
      );
    }

    try {
      return await operation();
    } catch (error) {
      if (options.signal.aborted) {
        throw cancellationError(
          options.signal.reason as CancellationReason | undefined,
        );
      }
      if (
        !isCLIError(error) ||
        !error.retryable ||
        attempt > policy.maxRetries
      ) {
        throw error;
      }

      const retryNumber = attempt;
      const nextAttempt = attempt + 1;
      const serverDelay = retryAfterMs(error);
      const delayMs = serverDelay ?? backoffDelayMs(retryNumber, policy, random);

      options.logger.log('warn', 'retry.scheduled', {
        attempt: nextAttempt,
        maxAttempts: policy.maxRetries + 1,
        delayMs,
        source: serverDelay === undefined ? 'backoff' : 'retryAfter',
        errorCode: error.code,
      });
      await sleep(delayMs, options.signal);
      options.logger.log('info', 'retry.started', {
        attempt: nextAttempt,
        maxAttempts: policy.maxRetries + 1,
      });
      attempt = nextAttempt;
    }
  }
}
