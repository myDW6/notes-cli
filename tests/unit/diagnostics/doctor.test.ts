import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runDoctor } from '../../../src/diagnostics/doctor.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'notes-doctor-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe('doctor diagnostics', () => {
  it('warns for an uninitialized data directory without creating it', async () => {
    const root = await makeTempDir();
    const configDir = path.join(root, 'config');
    const dataDir = path.join(configDir, 'data');

    const report = await runDoctor({
      configPath: configDir,
      env: {},
    }, '22.0.0');

    expect(report.status).toBe('warn');
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'runtime.node', status: 'pass' }),
      expect.objectContaining({ id: 'config.resolve', status: 'pass' }),
      expect.objectContaining({ id: 'dataDir.type', status: 'warn' }),
      expect.objectContaining({ id: 'dataDir.writable', status: 'pass' }),
      expect.objectContaining({ id: 'storage.format', status: 'skip' }),
    ]));
    await expect(fs.stat(dataDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('continues independent checks when configuration is malformed', async () => {
    const configDir = await makeTempDir();
    await fs.writeFile(path.join(configDir, 'config.json'), '{broken');

    const report = await runDoctor({
      configPath: configDir,
      env: {},
    }, '22.0.0');

    expect(report.status).toBe('fail');
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'runtime.node', status: 'pass' }),
      expect.objectContaining({
        id: 'config.resolve',
        status: 'fail',
        details: expect.objectContaining({ code: 'CONFIG_PARSE_ERROR' }),
      }),
      expect.objectContaining({ id: 'storage.format', status: 'skip' }),
    ]));
    expect(report.summary).toMatchObject({ pass: 1, fail: 1, skip: 4 });
  });

  it('reports an unsupported storage format as a failed check', async () => {
    const dataDir = await makeTempDir();
    await fs.writeFile(path.join(dataDir, 'notes.json'), '{"schemaVersion":99,"notes":[]}');

    const report = await runDoctor({
      configPath: await makeTempDir(),
      dataDir,
      env: {},
    }, '22.0.0');

    expect(report.status).toBe('fail');
    expect(report.checks).toContainEqual(expect.objectContaining({
      id: 'storage.format',
      status: 'fail',
      details: expect.objectContaining({
        format: 'unsupported',
        schemaVersion: 99,
      }),
    }));
  });
});
