import { createHash } from 'node:crypto';
import { CLIError } from './errors.js';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}

export function canonicalJSON(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function requestFingerprint(value: unknown): string {
  const digest = createHash('sha256')
    .update(canonicalJSON(value), 'utf-8')
    .digest('hex');
  return `sha256:${digest}`;
}

export function normalizeIdempotencyKey(raw: string): string {
  const key = raw.trim();
  if (key.length < 1 || key.length > 200) {
    throw new CLIError(
      'usage',
      'INVALID_ARGUMENT',
      'idempotency key must contain between 1 and 200 characters',
      '',
      [],
      {
        argument: 'idempotency-key',
        valueLength: key.length,
        expected: '1 to 200 characters',
      },
    );
  }
  return key;
}
