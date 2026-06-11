import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CancellationContext,
  SIGINT_EXIT_CODE,
  SIGTERM_EXIT_CODE,
  TIMEOUT_EXIT_CODE,
  cancellationError,
  cancellationExitCode,
} from '../../../src/cli/cancellation.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('cancellation context', () => {
  it('maps signals and timeouts to stable exit codes', () => {
    expect(cancellationExitCode({ kind: 'timeout', timeoutMs: 10 })).toBe(TIMEOUT_EXIT_CODE);
    expect(cancellationExitCode({ kind: 'signal', signal: 'SIGINT' })).toBe(SIGINT_EXIT_CODE);
    expect(cancellationExitCode({ kind: 'signal', signal: 'SIGTERM' })).toBe(SIGTERM_EXIT_CODE);
  });

  it('aborts when an armed timeout expires', () => {
    vi.useFakeTimers();
    const cancellation = new CancellationContext();
    cancellation.armTimeout(1_000);

    vi.advanceTimersByTime(1_000);

    expect(cancellation.signal.aborted).toBe(true);
    expect(cancellation.reason).toEqual({ kind: 'timeout', timeoutMs: 1_000 });
    expect(cancellationError(cancellation.reason)).toMatchObject({
      code: 'OPERATION_TIMEOUT',
      retryable: true,
      details: { timeoutMs: 1_000 },
    });
  });

  it('keeps the first cancellation reason', () => {
    const cancellation = new CancellationContext();
    cancellation.cancelForSignal('SIGINT');
    cancellation.cancelForSignal('SIGTERM');

    expect(cancellation.reason).toEqual({ kind: 'signal', signal: 'SIGINT' });
  });
});
