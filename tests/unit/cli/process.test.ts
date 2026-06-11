import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  installBrokenPipeHandler,
  installSignalHandlers,
} from '../../../src/cli/process.js';

describe('broken pipe handling', () => {
  it('exits cleanly for EPIPE', () => {
    const stream = new EventEmitter();
    let exitCode: number | undefined;
    installBrokenPipeHandler(stream, (code) => {
      exitCode = code;
    });

    const error = Object.assign(new Error('broken pipe'), { code: 'EPIPE' });
    stream.emit('error', error);

    expect(exitCode).toBe(0);
  });

  it('rethrows non-EPIPE stream errors', () => {
    const stream = new EventEmitter();
    installBrokenPipeHandler(stream, () => undefined);

    expect(() => stream.emit(
      'error',
      Object.assign(new Error('write failed'), { code: 'EIO' }),
    )).toThrow('write failed');
  });

  it('forwards process signals to one cancellation owner', () => {
    const source = new EventEmitter();
    const received: string[] = [];
    const remove = installSignalHandlers({
      cancelForSignal: (signal) => received.push(signal),
    }, source);

    source.emit('SIGINT');
    source.emit('SIGTERM');
    remove();
    source.emit('SIGINT');

    expect(received).toEqual(['SIGINT', 'SIGTERM']);
  });
});
