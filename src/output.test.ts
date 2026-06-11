import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { emit, emitList, emitError } from './output.js';
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
    emit(
      { name: 'test' },
      {
        output: 'json',
        pretty: false,
        quiet: false,
        command: 'create',
        requestId: 'req_test',
      },
    );
    expect(JSON.parse(logs[0] as string)).toEqual({
      ok: true,
      apiVersion: 'notes.cli/v1',
      command: 'create',
      requestId: 'req_test',
      data: { name: 'test' },
    });
  });

  it('emits pretty JSON', () => {
    emit(
      { name: 'test' },
      {
        output: 'json',
        pretty: true,
        quiet: false,
        command: 'create',
        requestId: 'req_test',
      },
    );
    expect(logs[0]).toContain('\n');
  });

  it('emits list envelope in JSON', () => {
    emitList(
      [{ id: '1' }],
      { hasMore: true, next: '10' },
      {
        output: 'json',
        pretty: false,
        quiet: false,
        command: 'list',
        requestId: 'req_test',
      },
    );
    const parsed = JSON.parse(logs[0] as string);
    expect(parsed.data.items).toHaveLength(1);
    expect(parsed.data.page.hasMore).toBe(true);
    expect(parsed.data.page.nextCursor).toBe('10');
  });

  it('emits error as JSON to stderr', () => {
    const err = new CLIError('not_found', 'MISSING', 'Not found', 'Try again', ['notes list']);
    emitError(err, {
      command: 'get',
      requestId: 'req_test',
      pretty: false,
    });
    expect(errors).toHaveLength(1);
    const parsed = JSON.parse(errors[0] as string);
    expect(parsed.ok).toBe(false);
    expect(parsed.command).toBe('get');
    expect(parsed.error.code).toBe('MISSING');
    expect(parsed.error.nextSteps).toEqual(['notes list']);
  });

  it('projects list item fields while preserving page metadata', () => {
    emitList(
      [{ id: '1', title: 'A', content: 'hidden' }],
      { hasMore: false },
      {
        output: 'json',
        pretty: false,
        quiet: false,
        command: 'list',
        requestId: 'req_test',
        fields: ['id', 'title'],
      },
    );

    expect(JSON.parse(logs[0] as string).data).toEqual({
      items: [{ id: '1', title: 'A' }],
      page: { hasMore: false },
    });
  });

  it('suppresses successful output in quiet mode', () => {
    emit(
      { id: '1' },
      {
        output: 'table',
        pretty: false,
        quiet: true,
        command: 'delete',
        requestId: 'req_test',
      },
    );
    expect(logs).toEqual([]);
  });
});
