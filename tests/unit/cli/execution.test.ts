import { describe, expect, it } from 'vitest';
import { CLIError } from '../../../src/cli/errors.js';
import { resolveExecutionMode } from '../../../src/cli/execution.js';

describe('resolveExecutionMode', () => {
  it('uses TTY as the default for table interaction', () => {
    expect(resolveExecutionMode({
      output: 'table',
      noInput: false,
      interactive: false,
      stdinIsTTY: true,
      stdoutIsTTY: true,
    })).toMatchObject({
      interactive: true,
      output: 'table',
    });
  });

  it('disables interaction for JSON output', () => {
    expect(resolveExecutionMode({
      output: 'json',
      noInput: false,
      interactive: false,
      stdinIsTTY: true,
      stdoutIsTTY: true,
    }).interactive).toBe(false);
  });

  it('lets --no-input override TTY defaults', () => {
    expect(resolveExecutionMode({
      output: 'table',
      noInput: true,
      interactive: false,
      stdinIsTTY: true,
      stdoutIsTTY: true,
    }).interactive).toBe(false);
  });

  it('rejects conflicting interaction options', () => {
    expect(() => resolveExecutionMode({
      output: 'table',
      noInput: true,
      interactive: true,
      stdinIsTTY: true,
      stdoutIsTTY: true,
    })).toThrowError(CLIError);
  });
});
