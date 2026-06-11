import { describe, expect, it } from 'vitest';
import { createLogger } from '../../../src/cli/logger.js';

function memoryWriter(options: { failWrite?: boolean } = {}) {
  const lines: string[] = [];
  return {
    lines,
    writer: {
      write(line: string): void {
        if (options.failWrite) throw new Error('disk full');
        lines.push(line);
      },
      close(): void {},
    },
  };
}

describe('structured logger', () => {
  it('writes correlated JSONL events and respects the level threshold', () => {
    const output = memoryWriter();
    const logger = createLogger({
      level: 'info',
      format: 'json',
      context: () => ({ requestId: 'req_test', command: 'list' }),
      now: () => new Date('2026-06-11T00:00:00.000Z'),
      writer: output.writer,
    });

    logger.log('debug', 'storage.read.started');
    logger.log('info', 'command.completed', { durationMs: 12 });

    expect(output.lines).toHaveLength(1);
    expect(JSON.parse(output.lines[0])).toEqual({
      schemaVersion: 'notes.log/v1',
      timestamp: '2026-06-11T00:00:00.000Z',
      level: 'info',
      event: 'command.completed',
      requestId: 'req_test',
      command: 'list',
      durationMs: 12,
    });
  });

  it('does not allow event fields to replace correlation metadata', () => {
    const output = memoryWriter();
    const logger = createLogger({
      level: 'info',
      format: 'json',
      context: () => ({ requestId: 'req_actual', command: 'list' }),
      writer: output.writer,
    });

    logger.log('info', 'command.started', {
      requestId: 'req_spoofed',
      event: 'spoofed',
      command: 'delete',
    });

    expect(JSON.parse(output.lines[0])).toMatchObject({
      requestId: 'req_actual',
      event: 'command.started',
      command: 'list',
    });
  });

  it('redacts sensitive fields recursively', () => {
    const output = memoryWriter();
    const logger = createLogger({
      level: 'debug',
      format: 'json',
      context: () => ({ requestId: 'req_test', command: 'create' }),
      writer: output.writer,
    });

    logger.log('debug', 'request.prepared', {
      token: 'secret-token',
      nested: { apiKey: 'secret-key', count: 1 },
    });

    expect(JSON.parse(output.lines[0])).toMatchObject({
      token: '[REDACTED]',
      nested: { apiKey: '[REDACTED]', count: 1 },
    });
  });

  it('does not throw when the diagnostic sink fails', () => {
    const output = memoryWriter({ failWrite: true });
    const logger = createLogger({
      level: 'info',
      format: 'json',
      context: () => ({ requestId: 'req_test', command: 'get' }),
      writer: output.writer,
    });

    expect(() => logger.log('error', 'command.failed')).not.toThrow();
    expect(() => logger.close()).not.toThrow();
  });

  it('supports a human-readable text sink', () => {
    const output = memoryWriter();
    const logger = createLogger({
      level: 'info',
      format: 'text',
      context: () => ({ requestId: 'req_test', command: 'list' }),
      now: () => new Date('2026-06-11T00:00:00.000Z'),
      writer: output.writer,
    });

    logger.log('info', 'command.started', { output: 'json' });

    expect(output.lines[0]).toBe(
      '2026-06-11T00:00:00.000Z INFO command.started schemaVersion=notes.log/v1 requestId=req_test command=list {"output":"json"}\n',
    );
  });
});
