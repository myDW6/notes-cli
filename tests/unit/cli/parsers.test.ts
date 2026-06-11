import { describe, expect, it } from 'vitest';
import {
  parseFields,
  parseLimit,
  parseOutputFormat,
  parseTags,
} from '../../../src/cli/parsers.js';

describe('CLI parsers', () => {
  it('normalizes and deduplicates projected fields', () => {
    expect(parseFields(' id, title,id ')).toEqual(['id', 'title']);
    expect(parseFields(undefined)).toBeUndefined();
  });

  it('rejects an empty field projection', () => {
    expect(() => parseFields(' , ')).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
  });

  it('validates bounded integer limits', () => {
    expect(parseLimit('25')).toBe(25);
    expect(() => parseLimit('0')).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    expect(() => parseLimit('1.5')).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
  });

  it('validates output formats and normalizes tags', () => {
    expect(parseOutputFormat('jsonl')).toBe('jsonl');
    expect(() => parseOutputFormat('xml')).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    expect(parseTags(' agent, cli,agent ')).toEqual(['agent', 'cli', 'agent']);
  });
});
