import { spawn, spawnSync } from 'node:child_process';
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

function runCLI(
  args: string[],
  input?: string,
  env?: Record<string, string | undefined>,
): CLIResult {
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
        ...env,
      },
    },
  );
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function runCLIAndSignal(
  args: string[],
  signal: NodeJS.Signals,
): Promise<CLIResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'src/index.ts', ...args],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NO_COLOR: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    let signalled = false;
    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (!signalled && stdout.includes('\n')) {
        signalled = true;
        child.kill(signal);
      }
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('CLI contract', () => {
  it('publishes concrete capabilities in the standard envelope', () => {
    const result = runCLI(['capabilities', '--output', 'json']);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      apiVersion: 'notes.cli/v1',
      command: 'capabilities',
      data: {
        commands: {
          create: {
            readOnly: false,
            destructive: false,
            supportsDryRun: true,
            supportsStructuredInput: true,
          },
          delete: {
            destructive: true,
            requiresConfirmation: true,
            supportsDryRun: true,
          },
        },
        outputFormats: ['table', 'json', 'jsonl'],
        protocolVersions: ['notes.cli/v1'],
      },
    });
  });

  it('publishes structured deprecation metadata without changing the API version', () => {
    const result = runCLI(['capabilities', '--output', 'json']);
    const payload = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(payload.apiVersion).toBe('notes.cli/v1');
    expect(payload.data.compatibility.deprecatedOptions).toContainEqual({
      name: '--format',
      shortName: '-f',
      replacement: '--output',
      removalVersion: '2.0.0',
    });
  });

  it('rejects timeout values without an explicit unit', () => {
    const result = runCLI([
      'list',
      '--timeout',
      '30',
      '--data-dir',
      makeTempDir(),
    ]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr).error.code).toBe('INVALID_DURATION');
  });

  it('keeps the deprecated format option compatible in machine mode', () => {
    const result = runCLI([
      'list',
      '--all',
      '--format',
      'json',
      '--data-dir',
      makeTempDir(),
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      apiVersion: 'notes.cli/v1',
      command: 'list',
      data: {
        items: [],
        page: { hasMore: false },
      },
    });
  });

  it('accepts matching output and legacy format values', () => {
    const result = runCLI([
      'list',
      '--all',
      '--output',
      'json',
      '--format',
      'json',
      '--data-dir',
      makeTempDir(),
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout).apiVersion).toBe('notes.cli/v1');
  });

  it('rejects conflicting output aliases with a stable error', () => {
    const result = runCLI([
      'list',
      '--output',
      'json',
      '--format',
      'table',
      '--data-dir',
      makeTempDir(),
    ]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr)).toMatchObject({
      apiVersion: 'notes.cli/v1',
      error: {
        code: 'CONFLICTING_OPTIONS',
        details: { options: ['output', 'format'] },
      },
    });
  });

  it('warns for deprecated options only after successful human output', () => {
    const result = runCLI([
      'list',
      '--format',
      'table',
      '--data-dir',
      makeTempDir(),
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('(no results)');
    expect(result.stderr).toBe(
      'Warning [DEPRECATED_OPTION]: --format is deprecated; ' +
      'use --output. It will be removed in 2.0.0.\n',
    );
  });

  it('keeps failed legacy invocations as one structured stderr document', () => {
    const result = runCLI([
      'delete',
      'missing',
      '--yes',
      '--format',
      'table',
      '--data-dir',
      makeTempDir(),
    ]);

    expect(result.status).toBe(6);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr).error.code).toBe('NOTE_NOT_FOUND');
    expect(result.stderr).not.toContain('DEPRECATED_OPTION');
  });

  it('keeps the deprecated format option hidden from help', () => {
    const result = runCLI(['--help']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--output <format>');
    expect(result.stdout).not.toContain('--format <format>');
  });

  it('publishes the create input JSON Schema', () => {
    const result = runCLI(['schema', 'create', '--output', 'json']);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: 'schema.create',
      data: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: 'notes.cli/v1/create-input',
        type: 'object',
        additionalProperties: false,
        required: ['title'],
        properties: {
          title: { type: 'string', minLength: 1 },
          content: { type: 'string', default: '' },
          tags: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
            default: [],
          },
        },
      },
    });
  });

  it('publishes the batch item JSON Schema', () => {
    const result = runCLI(['schema', 'batch', '--output', 'json']);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: 'schema.batch',
      data: {
        $id: 'notes.cli/v1/batch-item',
        oneOf: [
          {
            properties: {
              operation: { const: 'create' },
            },
          },
          {
            properties: {
              operation: { const: 'delete' },
              confirm: { const: true },
            },
          },
        ],
      },
    });
  });

  it('keeps discovery available when the notes config is invalid', () => {
    const configDir = makeTempDir();
    fs.writeFileSync(path.join(configDir, 'config.json'), '{invalid json');

    const capabilities = runCLI([
      'capabilities',
      '--output',
      'json',
      '--config',
      configDir,
    ]);
    const schema = runCLI([
      'schema',
      'create',
      '--output',
      'json',
      '--config',
      configDir,
    ]);

    expect(capabilities.status).toBe(0);
    expect(JSON.parse(capabilities.stdout).command).toBe('capabilities');
    expect(schema.status).toBe(0);
    expect(JSON.parse(schema.stdout).command).toBe('schema.create');
  });

  it('reports an uninitialized environment as a successful doctor warning', () => {
    const configDir = makeTempDir();
    const result = runCLI([
      'doctor',
      '--output',
      'json',
      '--config',
      path.join(configDir, 'missing-config'),
    ], undefined, {
      NOTES_DATA_DIR: undefined,
      NOTES_FORMAT: undefined,
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: 'doctor',
      data: {
        status: 'warn',
        checks: expect.arrayContaining([
          expect.objectContaining({ id: 'runtime.node', status: 'pass' }),
          expect.objectContaining({ id: 'dataDir.type', status: 'warn' }),
          expect.objectContaining({ id: 'storage.format', status: 'skip' }),
        ]),
      },
    });
  });

  it('aggregates doctor failures in a success envelope and exits non-zero', () => {
    const configDir = makeTempDir();
    fs.writeFileSync(path.join(configDir, 'config.json'), '{invalid json');

    const result = runCLI([
      'doctor',
      '--output',
      'json',
      '--config',
      configDir,
    ], undefined, {
      NOTES_DATA_DIR: undefined,
      NOTES_FORMAT: undefined,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: 'doctor',
      data: {
        status: 'fail',
        checks: expect.arrayContaining([
          expect.objectContaining({ id: 'runtime.node', status: 'pass' }),
          expect.objectContaining({
            id: 'config.resolve',
            status: 'fail',
            details: expect.objectContaining({ code: 'CONFIG_PARSE_ERROR' }),
          }),
          expect.objectContaining({ id: 'dataDir.writable', status: 'skip' }),
        ]),
      },
    });
  });

  it('explains effective config values and their sources', () => {
    const root = makeTempDir();
    const configDir = path.join(root, 'config');
    fs.mkdirSync(configDir);
    fs.writeFileSync(
      path.join(configDir, 'config.json'),
      JSON.stringify({
        dataDir: './file-data',
        defaultFormat: 'table',
        pageSize: 40,
      }),
    );

    const result = runCLI([
      'config',
      'effective',
      '--config',
      configDir,
      '--data-dir',
      './flag-data',
      '--output',
      'json',
    ], undefined, {
      NOTES_DATA_DIR: './env-data',
      NOTES_FORMAT: 'table',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: 'config.effective',
      data: {
        configFile: path.join(configDir, 'config.json'),
        values: {
          configDir: {
            value: configDir,
            source: 'command-line',
            sourceName: '--config',
          },
          dataDir: {
            value: path.resolve('./flag-data'),
            source: 'command-line',
            sourceName: '--data-dir',
          },
          output: {
            value: 'json',
            source: 'command-line',
            sourceName: '--output',
          },
          pageSize: {
            value: 40,
            source: 'config-file',
          },
        },
      },
    });
  });

  it('rejects invalid environment configuration without silently falling back', () => {
    const result = runCLI([
      'list',
      '--output',
      'json',
      '--data-dir',
      makeTempDir(),
    ], undefined, {
      NOTES_FORMAT: 'xml',
    });

    expect(result.status).toBe(3);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr)).toMatchObject({
      command: 'list',
      error: {
        category: 'config',
        code: 'INVALID_ENVIRONMENT_VALUE',
        details: {
          variable: 'NOTES_FORMAT',
          value: 'xml',
        },
      },
    });
  });

  it('distinguishes a missing config file from a malformed config file', () => {
    const missing = runCLI([
      'config',
      'effective',
      '--config',
      makeTempDir(),
      '--output',
      'json',
    ], undefined, {
      NOTES_DATA_DIR: undefined,
      NOTES_FORMAT: undefined,
    });

    const invalidDir = makeTempDir();
    fs.writeFileSync(path.join(invalidDir, 'config.json'), '{invalid json');
    const invalid = runCLI([
      'config',
      'effective',
      '--config',
      invalidDir,
      '--output',
      'json',
    ], undefined, {
      NOTES_DATA_DIR: undefined,
      NOTES_FORMAT: undefined,
    });

    expect(missing.status).toBe(0);
    expect(JSON.parse(missing.stdout).data.values.pageSize).toMatchObject({
      value: 25,
      source: 'default',
    });
    expect(invalid.status).toBe(3);
    expect(JSON.parse(invalid.stderr).error.code).toBe('CONFIG_PARSE_ERROR');
  });

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

  it('replays create across processes when the idempotency key and input match', () => {
    const dataDir = makeTempDir();
    const args = [
      'create',
      '--title',
      'Retry-safe note',
      '--idempotency-key',
      'task-123',
      '--output',
      'json',
      '--data-dir',
      dataDir,
    ];

    const first = runCLI(args);
    const replay = runCLI(args);
    const firstData = JSON.parse(first.stdout).data;
    const replayData = JSON.parse(replay.stdout).data;

    expect(first.status).toBe(0);
    expect(replay.status).toBe(0);
    expect(firstData.id).toBe(replayData.id);
    expect(firstData.idempotency).toMatchObject({
      key: 'task-123',
      replayed: false,
    });
    expect(replayData.idempotency).toMatchObject({
      key: 'task-123',
      replayed: true,
    });

    const listed = runCLI([
      'list',
      '--all',
      '--output',
      'json',
      '--data-dir',
      dataDir,
    ]);
    expect(JSON.parse(listed.stdout).data.items).toHaveLength(1);
  });

  it('rejects an idempotency key reused with different create input', () => {
    const dataDir = makeTempDir();
    const commonArgs = [
      '--idempotency-key',
      'task-123',
      '--output',
      'json',
      '--data-dir',
      dataDir,
    ];

    const first = runCLI(['create', '--title', 'A', ...commonArgs]);
    const conflict = runCLI(['create', '--title', 'B', ...commonArgs]);

    expect(first.status).toBe(0);
    expect(conflict.status).toBe(11);
    expect(conflict.stdout).toBe('');
    expect(JSON.parse(conflict.stderr)).toMatchObject({
      error: {
        category: 'conflict',
        code: 'IDEMPOTENCY_KEY_REUSED',
        retryable: false,
        details: {
          key: 'task-123',
          command: 'create',
        },
      },
    });
  });

  it('does not reserve an idempotency key during dry-run', () => {
    const dataDir = makeTempDir();
    const commonArgs = [
      '--title',
      'A',
      '--idempotency-key',
      'task-123',
      '--output',
      'json',
      '--data-dir',
      dataDir,
    ];

    const preview = runCLI(['create', '--dry-run', ...commonArgs]);
    const created = runCLI(['create', ...commonArgs]);

    expect(preview.status).toBe(0);
    expect(JSON.parse(preview.stdout).data.idempotency).toMatchObject({
      key: 'task-123',
      stored: false,
    });
    expect(created.status).toBe(0);
    expect(JSON.parse(created.stdout).data.idempotency.replayed).toBe(false);
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

  it('rejects unknown fields in structured input', () => {
    const result = runCLI(
      ['create', '--input', '-', '--output', 'json', '--data-dir', makeTempDir()],
      '{"title":"A","contents":"typo"}',
    );

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: {
        code: 'UNKNOWN_INPUT_FIELD',
        details: {
          field: 'contents',
          allowedFields: ['title', 'content', 'tags'],
        },
      },
    });
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

  it('streams item results and returns exit 12 for partial batch failure', () => {
    const dataDir = makeTempDir();
    const input = [
      '{"operation":"create","idempotencyKey":"batch-1","input":{"title":"A"}}',
      '',
      '{"operation":"create","input":{"title":""}}',
      '{"operation":"create","idempotencyKey":"batch-3","input":{"title":"C"}}',
    ].join('\n');

    const result = runCLI([
      'batch',
      '--input-jsonl',
      '-',
      '--output',
      'jsonl',
      '--data-dir',
      dataDir,
    ], input);

    expect(result.status).toBe(12);
    expect(result.stderr).toBe('');
    const lines = result.stdout.trim().split('\n').map((line) => JSON.parse(line));
    expect(lines).toMatchObject([
      {
        index: 0,
        line: 1,
        operation: 'create',
        ok: true,
        data: { title: 'A', idempotency: { replayed: false } },
      },
      {
        index: 1,
        line: 3,
        operation: 'create',
        ok: false,
        error: { code: 'MISSING_REQUIRED_INPUT' },
      },
      {
        index: 2,
        line: 4,
        operation: 'create',
        ok: true,
        data: { title: 'C', idempotency: { replayed: false } },
      },
    ]);
  });

  it('stops batch processing on the first error with --fail-fast', () => {
    const result = runCLI([
      'batch',
      '--input-jsonl',
      '-',
      '--output',
      'jsonl',
      '--fail-fast',
      '--data-dir',
      makeTempDir(),
    ], [
      '{"operation":"create","input":{"title":"A"}}',
      '{"operation":"create","input":{"title":""}}',
      '{"operation":"create","input":{"title":"C"}}',
    ].join('\n'));

    expect(result.status).toBe(2);
    expect(result.stdout.trim().split('\n')).toHaveLength(2);
  });

  it('treats unreadable batch input as a batch-level stderr error', () => {
    const result = runCLI([
      'batch',
      '--input-jsonl',
      '/missing/operations.jsonl',
      '--output',
      'jsonl',
      '--data-dir',
      makeTempDir(),
    ]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr)).toMatchObject({
      command: 'batch',
      error: {
        code: 'INPUT_READ_ERROR',
        details: { path: '/missing/operations.jsonl' },
      },
    });
  });

  it('requires explicit JSONL output for batch', () => {
    const result = runCLI([
      'batch',
      '--input-jsonl',
      '-',
      '--output',
      'json',
      '--data-dir',
      makeTempDir(),
    ], '');

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr).error.code).toBe('OUTPUT_FORMAT_REQUIRED');
  });

  it('replays successful batch creates and requires delete confirmation', () => {
    const dataDir = makeTempDir();
    const createLine =
      '{"operation":"create","idempotencyKey":"batch-1","input":{"title":"A"}}';

    const first = runCLI([
      'batch',
      '--input-jsonl',
      '-',
      '--output',
      'jsonl',
      '--data-dir',
      dataDir,
    ], createLine);
    const replay = runCLI([
      'batch',
      '--input-jsonl',
      '-',
      '--output',
      'jsonl',
      '--data-dir',
      dataDir,
    ], createLine);
    const id = JSON.parse(first.stdout).data.id as string;

    expect(JSON.parse(replay.stdout).data.idempotency.replayed).toBe(true);

    const deleteResult = runCLI([
      'batch',
      '--input-jsonl',
      '-',
      '--output',
      'jsonl',
      '--data-dir',
      dataDir,
    ], [
      `{"operation":"delete","input":{"id":"${id}"},"confirm":false}`,
      `{"operation":"delete","input":{"id":"${id}"},"confirm":true}`,
    ].join('\n'));

    expect(deleteResult.status).toBe(12);
    const results = deleteResult.stdout.trim().split('\n').map((line) => JSON.parse(line));
    expect(results[0]).toMatchObject({
      ok: false,
      error: { code: 'CONFIRMATION_REQUIRED' },
    });
    expect(results[1]).toMatchObject({
      ok: true,
      data: { deleted: true, id },
    });
  });

  it('emits a cancellation summary and exits 124 when batch times out', () => {
    const root = makeTempDir();
    const inputPath = path.join(root, 'operations.jsonl');
    fs.writeFileSync(
      inputPath,
      Array.from(
        { length: 500 },
        (_, index) =>
          `{"operation":"create","input":{"title":"timeout-${index}"}}`,
      ).join('\n'),
    );

    const result = runCLI([
      'batch',
      '--input-jsonl',
      inputPath,
      '--output',
      'jsonl',
      '--timeout',
      '20ms',
      '--data-dir',
      path.join(root, 'data'),
    ]);
    const lines = result.stdout.trim().split('\n').map((line) => JSON.parse(line));
    const summary = lines.at(-1);

    expect(result.status).toBe(124);
    expect(result.stderr).toBe('');
    expect(summary).toMatchObject({
      apiVersion: 'notes.cli/v1',
      type: 'summary',
      status: 'cancelled',
      cancellation: {
        kind: 'timeout',
        code: 'OPERATION_TIMEOUT',
        retryable: true,
        timeoutMs: 20,
      },
    });
    expect(lines.slice(0, -1).every((line) => line.type === 'item')).toBe(true);
  });

  it('emits a cancellation summary and exits 130 after SIGINT', async () => {
    const root = makeTempDir();
    const inputPath = path.join(root, 'operations.jsonl');
    fs.writeFileSync(
      inputPath,
      Array.from(
        { length: 200 },
        (_, index) =>
          `{"operation":"create","input":{"title":"signal-${index}"}}`,
      ).join('\n'),
    );

    const result = await runCLIAndSignal([
      'batch',
      '--input-jsonl',
      inputPath,
      '--output',
      'jsonl',
      '--data-dir',
      path.join(root, 'data'),
    ], 'SIGINT');
    const lines = result.stdout.trim().split('\n').map((line) => JSON.parse(line));

    expect(result.status).toBe(130);
    expect(result.stderr).toBe('');
    expect(lines[0]).toMatchObject({ type: 'item', ok: true });
    expect(lines.at(-1)).toMatchObject({
      type: 'summary',
      status: 'cancelled',
      cancellation: {
        kind: 'signal',
        code: 'OPERATION_CANCELLED',
        retryable: false,
        signal: 'SIGINT',
      },
    });
  });

  it('projects fields inside list data without removing the envelope', () => {
    const dataDir = makeTempDir();
    runCLI([
      'create',
      '--title',
      'Projected',
      '--content',
      'hidden',
      '--output',
      'json',
      '--data-dir',
      dataDir,
    ]);

    const result = runCLI([
      'list',
      '--all',
      '--fields',
      'id,title',
      '--output',
      'json',
      '--data-dir',
      dataDir,
    ]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: 'list',
      data: {
        items: [{ title: 'Projected' }],
        page: { hasMore: false },
      },
    });
    expect(JSON.parse(result.stdout).data.items[0]).not.toHaveProperty('content');
  });

  it('suppresses successful table output with --quiet but preserves errors', () => {
    const dataDir = makeTempDir();
    const created = runCLI([
      'create',
      '--title',
      'Quiet',
      '--quiet',
      '--no-input',
      '--data-dir',
      dataDir,
    ]);
    const failed = runCLI([
      'delete',
      'missing',
      '--yes',
      '--quiet',
      '--no-input',
      '--data-dir',
      dataDir,
    ]);

    expect(created.status).toBe(0);
    expect(created.stdout).toBe('');
    expect(created.stderr).toBe('');
    expect(failed.status).toBe(6);
    expect(failed.stdout).toBe('');
    expect(JSON.parse(failed.stderr).error.code).toBe('NOTE_NOT_FOUND');
  });

  it('rejects quiet with machine-readable output', () => {
    const result = runCLI([
      'list',
      '--quiet',
      '--output',
      'json',
      '--data-dir',
      makeTempDir(),
    ]);

    expect(result.status).toBe(2);
    expect(JSON.parse(result.stderr).error.code).toBe('CONFLICTING_OPTIONS');
  });

  it('writes raw JSON export content to stdout', () => {
    const dataDir = makeTempDir();
    runCLI([
      'create',
      '--title',
      'Exported',
      '--output',
      'json',
      '--data-dir',
      dataDir,
    ]);

    const result = runCLI([
      'export',
      '-',
      '--export-format',
      'json',
      '--data-dir',
      dataDir,
    ]);
    const exported = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(exported).toMatchObject({
      exportedFrom: 'notes-cli',
      count: 1,
      notes: [{ title: 'Exported' }],
    });
    expect(exported).not.toHaveProperty('ok');
  });

  it('writes raw CSV export content to stdout', () => {
    const dataDir = makeTempDir();
    runCLI([
      'create',
      '--title',
      'CSV note',
      '--content',
      'body',
      '--output',
      'json',
      '--data-dir',
      dataDir,
    ]);

    const result = runCLI([
      'export',
      '-',
      '--export-format',
      'csv',
      '--data-dir',
      dataDir,
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toMatch(/^id,title,content,tags,createdAt,updatedAt\n/);
    expect(result.stdout).toContain(',CSV note,body,');
  });

  it('rejects protocol projection options for raw stdout export', () => {
    const result = runCLI([
      'export',
      '-',
      '--export-format',
      'json',
      '--fields',
      'id,title',
      '--data-dir',
      makeTempDir(),
    ]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr).error.code).toBe('RAW_OUTPUT_CONFLICT');
  });

  it('rejects the legacy protocol output option for raw stdout export', () => {
    const result = runCLI([
      'export',
      '-',
      '--export-format',
      'json',
      '--format',
      'json',
      '--data-dir',
      makeTempDir(),
    ]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr).error.code).toBe('RAW_OUTPUT_CONFLICT');
  });
});
