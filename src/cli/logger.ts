import fs from 'node:fs';
import path from 'node:path';
import { CLIError } from './errors.js';

export const LOG_SCHEMA_VERSION = 'notes.log/v1' as const;

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';
export type LogFormat = 'json' | 'text';
export type LogFields = Record<string, unknown>;

export interface LogContext {
  requestId: string;
  command: string;
}

export interface Logger {
  log(level: LogLevel, event: string, fields?: LogFields): void;
  close(): void;
}

interface LogWriter {
  write(line: string): void;
  close(): void;
}

export interface CreateLoggerOptions {
  file?: string;
  level: LogLevel;
  format: LogFormat;
  context: () => LogContext;
  now?: () => Date;
  writer?: LogWriter;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const SENSITIVE_KEY = /token|password|secret|authorization|api[-_]?key/i;
const RESERVED_FIELDS = new Set([
  'schemaVersion',
  'timestamp',
  'level',
  'event',
  'requestId',
  'command',
]);

export const nullLogger: Logger = {
  log: () => {},
  close: () => {},
};

function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, seen));
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  const result: Record<string, unknown> = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY.test(key)
      ? '[REDACTED]'
      : redact(fieldValue, seen);
  }
  return result;
}

function openWriter(file: string): LogWriter {
  const resolvedPath = path.resolve(file);
  let descriptor: number;
  try {
    descriptor = fs.openSync(resolvedPath, 'a');
  } catch (error) {
    throw CLIError.wrap(
      error as Error,
      'config',
      'LOG_FILE_OPEN_ERROR',
      `Cannot open log file: ${resolvedPath}`,
    );
  }

  return {
    write(line: string): void {
      fs.writeSync(descriptor, line);
    },
    close(): void {
      fs.closeSync(descriptor);
    },
  };
}

function renderText(record: Record<string, unknown>): string {
  const {
    schemaVersion,
    timestamp,
    level,
    event,
    requestId,
    command,
    ...fields
  } = record;
  const suffix = Object.keys(fields).length > 0
    ? ` ${JSON.stringify(fields)}`
    : '';
  return `${timestamp} ${String(level).toUpperCase()} ${event} schemaVersion=${schemaVersion} requestId=${requestId} command=${command}${suffix}\n`;
}

export function createLogger(options: CreateLoggerOptions): Logger {
  if (!options.file && !options.writer) return nullLogger;

  const writer = options.writer ?? openWriter(options.file!);
  const now = options.now ?? (() => new Date());
  let available = true;
  let closed = false;

  return {
    log(level: LogLevel, event: string, fields: LogFields = {}): void {
      if (!available || LEVEL_PRIORITY[level] > LEVEL_PRIORITY[options.level]) return;

      const context = options.context();
      const safeFields = redact(fields) as LogFields;
      for (const field of RESERVED_FIELDS) {
        delete safeFields[field];
      }
      const record = {
        schemaVersion: LOG_SCHEMA_VERSION,
        timestamp: now().toISOString(),
        level,
        event,
        requestId: context.requestId,
        command: context.command,
        ...safeFields,
      };

      try {
        writer.write(
          options.format === 'json'
            ? `${JSON.stringify(record)}\n`
            : renderText(record),
        );
      } catch {
        // Observability is best-effort and must not replace the command outcome.
        available = false;
      }
    },
    close(): void {
      if (closed) return;
      try {
        writer.close();
      } catch {
        // Closing a diagnostic sink must not change the command exit contract.
      } finally {
        available = false;
        closed = true;
      }
    },
  };
}
