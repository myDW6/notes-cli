/**
 * 结构化错误模型
 * 对应 confluence-cli 的 internal/errors/
 */

export type ErrorCategory =
  | 'usage'
  | 'config'
  | 'not_found'
  | 'permission'
  | 'conflict'
  | 'internal';

export interface CLIErrorPayload {
  error: {
    category: ErrorCategory;
    code: string;
    message: string;
    hint?: string;
    nextSteps?: string[];
    retryable: boolean;
    details?: Record<string, unknown>;
  };
}

interface ErrorRecovery {
  retryable: boolean;
  hint?: string;
  nextSteps?: string[];
}

const ERROR_RECOVERY: Record<string, ErrorRecovery> = {
  CONFIG_PARSE_ERROR: {
    retryable: false,
    hint: 'Fix the config JSON or recreate the configuration file.',
    nextSteps: [
      'notes config init --no-input',
      'notes config effective --output json',
    ],
  },
  CONFIG_READ_ERROR: {
    retryable: false,
    hint: 'Check that the config file exists and is readable.',
    nextSteps: ['notes doctor --output json'],
  },
  INVALID_ENVIRONMENT_VALUE: {
    retryable: false,
    hint: 'Correct or unset the invalid environment variable.',
    nextSteps: ['notes config effective --output json'],
  },
  NOTE_NOT_FOUND: {
    retryable: false,
    hint: 'Check the note ID or discover the current notes.',
    nextSteps: ['notes list --output json'],
  },
  IDEMPOTENCY_KEY_REUSED: {
    retryable: false,
  },
  STORAGE_LOCKED: {
    retryable: true,
  },
  TEMPORARY_IO_FAILURE: {
    retryable: true,
  },
  OPERATION_TIMEOUT: {
    retryable: true,
  },
  OPERATION_CANCELLED: {
    retryable: false,
  },
};

export function errorRecovery(code: string): ErrorRecovery {
  return ERROR_RECOVERY[code] ?? { retryable: false };
}

export class CLIError extends Error {
  category: ErrorCategory;
  code: string;
  hint: string;
  nextSteps: string[];
  retryable: boolean;
  details?: Record<string, unknown>;

  constructor(
    category: ErrorCategory,
    code: string,
    message: string,
    hint = '',
    nextSteps: string[] = [],
    details?: Record<string, unknown>,
    retryable?: boolean,
  ) {
    super(message);
    const recovery = errorRecovery(code);
    this.name = 'CLIError';
    this.category = category;
    this.code = code;
    this.hint = hint || recovery.hint || '';
    this.nextSteps = nextSteps.length > 0
      ? nextSteps
      : [...(recovery.nextSteps ?? [])];
    this.retryable = retryable ?? recovery.retryable;
    this.details = details;
  }

  toJSON(): CLIErrorPayload {
    const payload: CLIErrorPayload = {
      error: {
        category: this.category,
        code: this.code,
        message: this.message,
        retryable: this.retryable,
      },
    };
    if (this.hint) payload.error.hint = this.hint;
    if (this.nextSteps.length > 0) payload.error.nextSteps = this.nextSteps;
    if (this.details) payload.error.details = this.details;
    return payload;
  }

  static wrap(
    cause: Error,
    category: ErrorCategory,
    code: string,
    message: string,
  ): CLIError {
    const err = new CLIError(category, code, message);
    err.cause = cause;
    return err;
  }
}

// 退出码映射（对应 confluence-cli 的 codes.go）
export function exitCode(category: ErrorCategory): number {
  const map: Record<ErrorCategory, number> = {
    usage: 2,
    config: 3,
    not_found: 6,
    permission: 5,
    conflict: 11,
    internal: 1,
  };
  return map[category] ?? 1;
}

export const BATCH_PARTIAL_FAILURE_EXIT_CODE = 12;

export function isCLIError(err: unknown): err is CLIError {
  return err instanceof CLIError;
}
