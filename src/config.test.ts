import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'notes-cli-config-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe('effective configuration', () => {
  it('resolves command line, environment, file and default values by priority', async () => {
    const cwd = await makeTempDir();
    const configDir = path.join(cwd, 'config');
    await fs.mkdir(configDir);
    await fs.writeFile(
      path.join(configDir, 'config.json'),
      JSON.stringify({
        dataDir: './file-data',
        defaultFormat: 'table',
        pageSize: 50,
      }),
    );

    const config = await loadConfig({
      cwd,
      configPath: './config',
      dataDir: './flag-data',
      output: 'json',
      env: {
        NOTES_DATA_DIR: './env-data',
        NOTES_FORMAT: 'table',
      },
    });

    expect(config.dataDir).toBe(path.join(cwd, 'flag-data'));
    expect(config.output).toBe('json');
    expect(config.pageSize).toBe(50);
    expect(config.effective).toMatchObject({
      configDir: {
        value: configDir,
        source: 'command-line',
        sourceName: '--config',
      },
      dataDir: {
        value: path.join(cwd, 'flag-data'),
        source: 'command-line',
        sourceName: '--data-dir',
      },
      output: {
        value: 'json',
        source: 'command-line',
        sourceName: '--output',
      },
      pageSize: {
        value: 50,
        source: 'config-file',
      },
    });
  });

  it('resolves relative file paths from the config directory', async () => {
    const cwd = await makeTempDir();
    const configDir = path.join(cwd, 'nested', 'config');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, 'config.json'),
      JSON.stringify({ dataDir: '../data' }),
    );

    const config = await loadConfig({
      cwd,
      configPath: './nested/config',
      env: {},
    });

    expect(config.dataDir).toBe(path.join(cwd, 'nested', 'data'));
    expect(config.effective.dataDir.source).toBe('config-file');
  });

  it('anchors the default data directory to the selected config directory', async () => {
    const cwd = await makeTempDir();
    const config = await loadConfig({
      cwd,
      configPath: './custom-config',
      env: {},
    });

    expect(config.dataDir).toBe(path.join(cwd, 'custom-config', 'data'));
    expect(config.effective.dataDir).toMatchObject({
      source: 'default',
      sourceName: 'built-in default',
    });
  });

  it('rejects an invalid environment value instead of falling back', async () => {
    await expect(loadConfig({
      configPath: await makeTempDir(),
      env: { NOTES_FORMAT: 'xml' },
    })).rejects.toMatchObject({
      category: 'config',
      code: 'INVALID_ENVIRONMENT_VALUE',
    });
  });

  it('rejects invalid and unknown config fields', async () => {
    const invalidDir = await makeTempDir();
    await fs.writeFile(
      path.join(invalidDir, 'config.json'),
      JSON.stringify({ pageSize: 0 }),
    );
    const unknownDir = await makeTempDir();
    await fs.writeFile(
      path.join(unknownDir, 'config.json'),
      JSON.stringify({ page_size: 25 }),
    );

    await expect(loadConfig({ configPath: invalidDir, env: {} }))
      .rejects.toMatchObject({ code: 'INVALID_CONFIG_FIELD' });
    await expect(loadConfig({ configPath: unknownDir, env: {} }))
      .rejects.toMatchObject({ code: 'UNKNOWN_CONFIG_FIELD' });
  });
});
