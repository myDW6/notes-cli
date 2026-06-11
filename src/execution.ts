import { randomUUID } from 'node:crypto';
import { CLIError } from './errors.js';
import type { OutputFormat } from './output.js';

export interface ExecutionMode {
  interactive: boolean;
  output: OutputFormat;
  color: boolean;
}

export interface ResolveExecutionModeOptions {
  output: OutputFormat;
  noInput: boolean;
  interactive: boolean;
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
}

export function resolveExecutionMode(options: ResolveExecutionModeOptions): ExecutionMode {
  if (options.noInput && options.interactive) {
    throw new CLIError(
      'usage',
      'CONFLICTING_OPTIONS',
      '--no-input cannot be combined with --interactive',
      '',
      [],
      { options: ['no-input', 'interactive'] },
    );
  }

  if (options.interactive && options.output !== 'table') {
    throw new CLIError(
      'usage',
      'CONFLICTING_OPTIONS',
      '--interactive requires --output table',
      '',
      [],
      { options: ['interactive', 'output'], output: options.output },
    );
  }

  if (options.interactive && options.stdinIsTTY !== true) {
    throw new CLIError(
      'usage',
      'TTY_REQUIRED',
      '--interactive requires an interactive terminal',
    );
  }

  const interactive =
    options.interactive ||
    (!options.noInput && options.output === 'table' && options.stdinIsTTY === true);

  return {
    interactive,
    output: options.output,
    color:
      options.output === 'table' &&
      options.stdoutIsTTY === true &&
      process.env.NO_COLOR === undefined,
  };
}

export function createRequestId(): string {
  return `req_${randomUUID()}`;
}
