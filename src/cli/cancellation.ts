import { CLIError } from './errors.js';

export type CancellationReason =
  | {
      kind: 'timeout';
      timeoutMs: number;
    }
  | {
      kind: 'signal';
      signal: 'SIGINT' | 'SIGTERM';
    };

export const TIMEOUT_EXIT_CODE = 124;
export const SIGINT_EXIT_CODE = 130;
export const SIGTERM_EXIT_CODE = 143;

export class CancellationContext {
  private readonly controller = new AbortController();
  private timeout?: NodeJS.Timeout;

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get reason(): CancellationReason | undefined {
    return this.controller.signal.reason as CancellationReason | undefined;
  }

  armTimeout(timeoutMs: number): void {
    if (this.timeout || this.signal.aborted) return;
    this.timeout = setTimeout(() => {
      this.abort({ kind: 'timeout', timeoutMs });
    }, timeoutMs);
  }

  cancelForSignal(signal: 'SIGINT' | 'SIGTERM'): void {
    this.abort({ kind: 'signal', signal });
  }

  throwIfAborted(): void {
    if (this.signal.aborted) {
      throw cancellationError(this.reason);
    }
  }

  dispose(): void {
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = undefined;
  }

  private abort(reason: CancellationReason): void {
    if (!this.signal.aborted) {
      this.controller.abort(reason);
    }
  }
}

export function cancellationExitCode(reason: CancellationReason | undefined): number {
  if (reason?.kind === 'timeout') return TIMEOUT_EXIT_CODE;
  if (reason?.signal === 'SIGINT') return SIGINT_EXIT_CODE;
  if (reason?.signal === 'SIGTERM') return SIGTERM_EXIT_CODE;
  return 1;
}

export function cancellationError(reason: CancellationReason | undefined): CLIError {
  if (reason?.kind === 'timeout') {
    return new CLIError(
      'internal',
      'OPERATION_TIMEOUT',
      `Operation exceeded the ${reason.timeoutMs}ms timeout`,
      'Increase --timeout or retry the operation later.',
      [],
      { timeoutMs: reason.timeoutMs },
      true,
    );
  }
  return new CLIError(
    'internal',
    'OPERATION_CANCELLED',
    `Operation was cancelled${reason?.kind === 'signal' ? ` by ${reason.signal}` : ''}`,
    'The operation stopped at a safe cancellation boundary.',
    [],
    reason?.kind === 'signal' ? { signal: reason.signal } : undefined,
    false,
  );
}
