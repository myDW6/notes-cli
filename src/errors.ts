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
  ) {
    super(message);
    this.name = 'CLIError';
    this.category = category;
    this.code = code;
    this.hint = hint;
    this.nextSteps = nextSteps;
    this.retryable = ['conflict', 'internal'].includes(category);
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

export function isCLIError(err: unknown): err is CLIError {
  return err instanceof CLIError;
}
