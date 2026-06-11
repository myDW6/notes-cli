import { describe, expect, it } from 'vitest';
import { CLIError, errorRecovery } from '../../../src/cli/errors.js';

describe('error recovery policy', () => {
  it('derives retryability from the concrete error code', () => {
    expect(new CLIError('conflict', 'IDEMPOTENCY_KEY_REUSED', 'conflict').retryable)
      .toBe(false);
    expect(new CLIError('conflict', 'STORAGE_LOCKED', 'locked').retryable)
      .toBe(true);
    expect(new CLIError('internal', 'INTERNAL', 'failed').retryable)
      .toBe(false);
  });

  it('publishes recovery guidance for known errors', () => {
    const error = new CLIError(
      'config',
      'CONFIG_PARSE_ERROR',
      'Config file is not valid JSON',
    );

    expect(error).toMatchObject({
      retryable: false,
      hint: 'Fix the config JSON or recreate the configuration file.',
      nextSteps: [
        'notes config init --no-input',
        'notes config effective --output json',
      ],
    });
    expect(errorRecovery('UNKNOWN_ERROR')).toEqual({ retryable: false });
  });

  it('allows a call site to explicitly override retryability', () => {
    expect(new CLIError(
      'internal',
      'INTERNAL',
      'failed',
      '',
      [],
      undefined,
      true,
    ).retryable).toBe(true);
  });
});
