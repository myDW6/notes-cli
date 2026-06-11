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
