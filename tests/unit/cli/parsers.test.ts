import { describe, expect, it } from 'vitest';
import {
  parseDuration,
  parseFields,
  parseLimit,
  parseLogFormat,
  parseLogLevel,
  parseMaxRetries,
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

  it('requires explicit timeout units', () => {
    expect(parseDuration('500ms')).toBe(500);
    expect(parseDuration('30s')).toBe(30_000);
    expect(parseDuration('5m')).toBe(300_000);
    expect(parseDuration('1h')).toBe(3_600_000);
    expect(() => parseDuration('30')).toThrowError(
      expect.objectContaining({ code: 'INVALID_DURATION' }),
    );
    expect(() => parseDuration('0s')).toThrowError(
      expect.objectContaining({ code: 'INVALID_DURATION' }),
    );
  });

  it('validates logging levels and formats', () => {
    expect(parseLogLevel('debug')).toBe('debug');
    expect(parseLogFormat('json')).toBe('json');
    expect(() => parseLogLevel('verbose')).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    expect(() => parseLogFormat('yaml')).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
  });

  it('validates the retry limit', () => {
    expect(parseMaxRetries('0')).toBe(0);
    expect(parseMaxRetries('3')).toBe(3);
    expect(() => parseMaxRetries('-1')).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    expect(() => parseMaxRetries('11')).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
  });
});
