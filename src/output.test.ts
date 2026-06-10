import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { emit, emitList, emitError, setGlobalPretty } from './output.js';
import { CLIError } from './errors.js';

describe('output', () => {
  let logs: unknown[] = [];
  let errors: unknown[] = [];

  beforeEach(() => {
    logs = [];
    errors = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args.join(' ')));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits JSON by default', () => {
    emit({ name: 'test' }, { format: 'json', pretty: false });
    expect(logs[0]).toBe('{"name":"test"}');
  });

  it('emits pretty JSON', () => {
    emit({ name: 'test' }, { format: 'json', pretty: true });
    expect(logs[0]).toContain('\n');
  });

  it('emits list envelope in JSON', () => {
    emitList([{ id: '1' }], { hasMore: true, next: '10' }, { format: 'json', pretty: false });
    const parsed = JSON.parse(logs[0] as string);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.has_more).toBe(true);
    expect(parsed.next).toBe('10');
  });

  it('emits error as JSON to stderr', () => {
    const err = new CLIError('not_found', 'MISSING', 'Not found', 'Try again', ['notes list']);
    setGlobalPretty(false);
    emitError(err);
    expect(errors).toHaveLength(1);
    const parsed = JSON.parse(errors[0] as string);
    expect(parsed.error.code).toBe('MISSING');
    expect(parsed.error.nextSteps).toEqual(['notes list']);
  });
});
