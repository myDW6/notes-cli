import { describe, expect, it } from 'vitest';
import {
  canonicalJSON,
  requestFingerprint,
} from '../../../src/notes/idempotency.js';

describe('idempotency fingerprinting', () => {
  it('sorts object keys while preserving array order', () => {
    expect(canonicalJSON({
      title: 'A',
      content: '',
      tags: ['cli', 'agent'],
    })).toBe(
      '{"content":"","tags":["cli","agent"],"title":"A"}',
    );
  });

  it('produces the same fingerprint for equivalent object key order', () => {
    expect(requestFingerprint({
      title: 'A',
      content: '',
      tags: [],
    })).toBe(requestFingerprint({
      tags: [],
      content: '',
      title: 'A',
    }));
  });
});
