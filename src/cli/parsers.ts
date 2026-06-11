import { CLIError } from './errors.js';
import type { OutputFormat } from './output.js';

export function parseOutputFormat(value: string): OutputFormat {
  if (value === 'table' || value === 'json' || value === 'jsonl') {
    return value;
  }
  throw new CLIError(
    'usage',
    'INVALID_ARGUMENT',
    '--output must be one of: table, json, jsonl',
    '',
    [],
    { argument: 'output', value, expected: ['table', 'json', 'jsonl'] },
  );
}

export function parseFields(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const fields = [...new Set(raw.split(',').map((field) => field.trim()).filter(Boolean))];
  if (fields.length === 0) {
    throw new CLIError(
      'usage',
      'INVALID_ARGUMENT',
      '--fields must contain at least one field name',
      '',
      [],
      { argument: 'fields', value: raw },
    );
  }
  return fields;
}

export function parseLimit(raw: string): number {
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || value < 1 || value > 1000) {
    throw new CLIError(
      'usage',
      'INVALID_ARGUMENT',
      '--limit must be an integer between 1 and 1000',
      '',
      [],
      { argument: 'limit', value: raw, expected: 'integer between 1 and 1000' },
    );
  }
  return value;
}

export function parseTags(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(',').map((tag) => tag.trim()).filter(Boolean);
}

const DURATION_UNITS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
};

export function parseDuration(raw: string): number {
  const match = /^(\d+)(ms|s|m|h)$/.exec(raw);
  if (!match) {
    throw new CLIError(
      'usage',
      'INVALID_DURATION',
      '--timeout must be a positive duration with unit: ms, s, m or h',
      '',
      [],
      { argument: 'timeout', value: raw, examples: ['500ms', '30s', '5m', '1h'] },
    );
  }
  const value = Number(match[1]);
  const timeoutMs = value * DURATION_UNITS[match[2]];
  if (value < 1 || !Number.isSafeInteger(timeoutMs)) {
    throw new CLIError(
      'usage',
      'INVALID_DURATION',
      '--timeout must be a positive safe duration',
      '',
      [],
      { argument: 'timeout', value: raw },
    );
  }
  return timeoutMs;
}
