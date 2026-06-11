import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

interface CLIResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-cli-contract-'));
  tempDirs.push(dir);
  return dir;
}

function runCLI(args: string[], input?: string): CLIResult {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'src/index.ts', ...args],
    {
      cwd: process.cwd(),
      encoding: 'utf-8',
      input,
      env: {
        ...process.env,
        NO_COLOR: '1',
      },
    },
  );
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('CLI contract', () => {
  it('creates a note with one clean JSON document on stdout', () => {
    const dataDir = makeTempDir();
    const result = runCLI([
      'create',
      '--title',
      'Agent note',
      '--output',
      'json',
      '--no-input',
      '--data-dir',
      dataDir,
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const payload = JSON.parse(result.stdout);
    expect(payload).toMatchObject({
      ok: true,
      apiVersion: 'notes.cli/v1',
      command: 'create',
      data: {
        title: 'Agent note',
        content: '',
        tags: [],
      },
    });
    expect(payload.requestId).toMatch(/^req_/);
  });

  it('returns a structured error when required input is missing', () => {
    const result = runCLI([
      'create',
      '--output',
      'json',
      '--no-input',
      '--data-dir',
      makeTempDir(),
    ]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr)).toMatchObject({
      ok: false,
      command: 'create',
      error: {
        code: 'MISSING_REQUIRED_INPUT',
        retryable: false,
        details: { field: 'title' },
      },
    });
  });

  it('reads structured create input only when --input - is explicit', () => {
    const result = runCLI(
      ['create', '--input', '-', '--output', 'json', '--data-dir', makeTempDir()],
      '{"title":"From stdin","tags":["agent"]}',
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).data).toMatchObject({
      title: 'From stdin',
      content: '',
      tags: ['agent'],
    });
  });

  it('rejects mixed structured and field input', () => {
    const dataDir = makeTempDir();
    const inputPath = path.join(dataDir, 'note.json');
    fs.writeFileSync(inputPath, '{"title":"From file"}');

    const result = runCLI([
      'create',
      '--input',
      inputPath,
      '--title',
      'Override',
      '--output',
      'json',
      '--data-dir',
      dataDir,
    ]);

    expect(result.status).toBe(2);
    expect(JSON.parse(result.stderr).error.code).toBe('CONFLICTING_INPUT');
  });

  it('validates list options', () => {
    const invalidLimit = runCLI([
      'list',
      '--limit',
      'abc',
      '--output',
      'json',
      '--data-dir',
      makeTempDir(),
    ]);
    expect(invalidLimit.status).toBe(2);
    expect(JSON.parse(invalidLimit.stderr).error.code).toBe('INVALID_ARGUMENT');

    const conflictingPageOptions = runCLI([
      'list',
      '--all',
      '--cursor',
      '10',
      '--output',
      'json',
      '--data-dir',
      makeTempDir(),
    ]);
    expect(conflictingPageOptions.status).toBe(2);
    expect(JSON.parse(conflictingPageOptions.stderr).error.code).toBe('CONFLICTING_OPTIONS');
  });

  it('requires explicit confirmation for non-interactive delete', () => {
    const result = runCLI([
      'delete',
      'note_123',
      '--output',
      'json',
      '--data-dir',
      makeTempDir(),
    ]);

    expect(result.status).toBe(2);
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: {
        code: 'CONFIRMATION_REQUIRED',
        details: { id: 'note_123' },
      },
    });
  });

  it('does not write during delete dry-run', () => {
    const dataDir = makeTempDir();
    const result = runCLI([
      'delete',
      'note_123',
      '--dry-run',
      '--output',
      'json',
      '--data-dir',
      dataDir,
    ]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).data).toMatchObject({
      operation: 'delete',
      executed: false,
      willWrite: true,
    });
    expect(fs.existsSync(path.join(dataDir, 'notes.json'))).toBe(false);
  });

  it('returns a page envelope and supports confirmed deletion', () => {
    const dataDir = makeTempDir();
    const created = runCLI([
      'create',
      '--title',
      'Delete me',
      '--output',
      'json',
      '--data-dir',
      dataDir,
    ]);
    expect(created.status).toBe(0);
    const id = JSON.parse(created.stdout).data.id as string;

    const listed = runCLI([
      'list',
      '--limit',
      '20',
      '--all',
      '--output',
      'json',
      '--data-dir',
      dataDir,
    ]);
    expect(listed.status).toBe(0);
    expect(JSON.parse(listed.stdout).data).toMatchObject({
      items: [{ id, title: 'Delete me' }],
      page: { hasMore: false },
    });

    const deleted = runCLI([
      'delete',
      id,
      '--yes',
      '--output',
      'json',
      '--data-dir',
      dataDir,
    ]);
    expect(deleted.status).toBe(0);
    expect(JSON.parse(deleted.stdout).data).toEqual({ deleted: true, id });
  });
});
