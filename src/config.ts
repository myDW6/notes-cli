/**
 * 配置管理层
 * 对应 confluence-cli 的 internal/config/
 *
 * 优先级：CLI flags > 环境变量 > 配置文件 > 内置默认值
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { input, select } from '@inquirer/prompts';
import { CLIError } from './errors.js';
import type { Config } from './types.js';
import type { OutputFormat } from './output.js';

const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.config', 'notes-cli');
const CONFIG_FILE = 'config.json';
const CONFIG_FIELDS = ['dataDir', 'defaultFormat', 'pageSize'] as const;

const defaults: Config = {
  dataDir: path.join(DEFAULT_CONFIG_DIR, 'data'),
  defaultFormat: 'table',
  pageSize: 25,
};

export interface LoadOptions {
  configPath?: string;
  dataDir?: string;
  output?: OutputFormat;
  outputSourceName?: '--output' | '--format';
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

export type ConfigSource = 'command-line' | 'environment' | 'config-file' | 'default';

export interface EffectiveValue<T> {
  value: T;
  source: ConfigSource;
  sourceName: string;
}

export interface EffectiveConfig {
  configDir: EffectiveValue<string>;
  dataDir: EffectiveValue<string>;
  output: EffectiveValue<OutputFormat>;
  pageSize: EffectiveValue<number>;
}

export interface ResolvedConfig {
  dataDir: string;
  pageSize: number;
  output: OutputFormat;
  configDir: string;
  configFile: string;
  effective: EffectiveConfig;
}

function configError(
  code: string,
  message: string,
  details: Record<string, unknown>,
): CLIError {
  return new CLIError('config', code, message, '', [], details, false);
}

function argumentError(
  code: string,
  message: string,
  details: Record<string, unknown>,
): CLIError {
  return new CLIError('usage', code, message, '', [], details, false);
}

function resolveConfigDir(opt: LoadOptions, cwd: string): EffectiveValue<string> {
  if (opt.configPath !== undefined) {
    if (opt.configPath.trim() === '') {
      throw argumentError('INVALID_CONFIG_PATH', '--config must not be empty', {
        source: 'command-line',
        sourceName: '--config',
      });
    }
    return {
      value: path.resolve(cwd, opt.configPath),
      source: 'command-line',
      sourceName: '--config',
    };
  }
  return {
    value: DEFAULT_CONFIG_DIR,
    source: 'default',
    sourceName: 'built-in default',
  };
}

function validateConfigFile(value: unknown, configFile: string): Partial<Config> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw configError('INVALID_CONFIG', 'Config file must contain a JSON object', {
      path: configFile,
      expected: 'object',
    });
  }

  const record = value as Record<string, unknown>;
  const unknownField = Object.keys(record).find(
    (field) => !CONFIG_FIELDS.includes(field as (typeof CONFIG_FIELDS)[number]),
  );
  if (unknownField) {
    throw configError('UNKNOWN_CONFIG_FIELD', `Unknown config field "${unknownField}"`, {
      path: configFile,
      field: unknownField,
      allowedFields: CONFIG_FIELDS,
    });
  }

  if (
    record.dataDir !== undefined &&
    (typeof record.dataDir !== 'string' || record.dataDir.trim() === '')
  ) {
    throw configError('INVALID_CONFIG_FIELD', 'Config field "dataDir" must be a non-empty string', {
      path: configFile,
      field: 'dataDir',
      value: record.dataDir,
      expected: 'non-empty string',
    });
  }
  if (
    record.defaultFormat !== undefined &&
    record.defaultFormat !== 'table' &&
    record.defaultFormat !== 'json'
  ) {
    throw configError(
      'INVALID_CONFIG_FIELD',
      'Config field "defaultFormat" must be one of: table, json',
      {
        path: configFile,
        field: 'defaultFormat',
        value: record.defaultFormat,
        expected: ['table', 'json'],
      },
    );
  }
  if (
    record.pageSize !== undefined &&
    (
      typeof record.pageSize !== 'number' ||
      !Number.isInteger(record.pageSize) ||
      record.pageSize < 1 ||
      record.pageSize > 1000
    )
  ) {
    throw configError(
      'INVALID_CONFIG_FIELD',
      'Config field "pageSize" must be an integer between 1 and 1000',
      {
        path: configFile,
        field: 'pageSize',
        value: record.pageSize,
        expected: 'integer between 1 and 1000',
      },
    );
  }

  return record as Partial<Config>;
}

async function readConfigFile(configDir: string): Promise<{
  config: Partial<Config>;
  configFile: string;
}> {
  const fp = path.join(configDir, CONFIG_FILE);
  try {
    const raw = await fs.readFile(fp, 'utf-8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (err) {
      throw configError('CONFIG_PARSE_ERROR', 'Config file is not valid JSON', {
        path: fp,
        cause: (err as Error).message,
      });
    }
    return {
      config: validateConfigFile(parsed, fp),
      configFile: fp,
    };
  } catch (err) {
    if (err instanceof CLIError) throw err;
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { config: {}, configFile: fp };
    }
    throw configError(
      'CONFIG_READ_ERROR',
      `Failed to read config: ${(err as Error).message}`,
      { path: fp },
    );
  }
}

export async function loadConfig(opt: LoadOptions): Promise<ResolvedConfig> {
  const cwd = opt.cwd ?? process.cwd();
  const env = opt.env ?? process.env;
  const configDir = resolveConfigDir(opt, cwd);
  const { config: fileLayer, configFile } = await readConfigFile(configDir.value);

  if (
    env.NOTES_DATA_DIR !== undefined &&
    env.NOTES_DATA_DIR.trim() === ''
  ) {
    throw configError('INVALID_ENVIRONMENT_VALUE', 'NOTES_DATA_DIR must not be empty', {
      variable: 'NOTES_DATA_DIR',
      value: env.NOTES_DATA_DIR,
      expected: 'non-empty path',
    });
  }
  if (
    env.NOTES_FORMAT !== undefined &&
    env.NOTES_FORMAT !== 'json' &&
    env.NOTES_FORMAT !== 'table'
  ) {
    throw configError(
      'INVALID_ENVIRONMENT_VALUE',
      'NOTES_FORMAT must be one of: table, json',
      {
        variable: 'NOTES_FORMAT',
        value: env.NOTES_FORMAT,
        expected: ['table', 'json'],
      },
    );
  }
  if (opt.dataDir !== undefined && opt.dataDir.trim() === '') {
    throw argumentError('INVALID_ARGUMENT', '--data-dir must not be empty', {
      argument: 'data-dir',
      value: opt.dataDir,
      expected: 'non-empty path',
    });
  }

  const dataDir: EffectiveValue<string> = opt.dataDir !== undefined
    ? {
        value: path.resolve(cwd, opt.dataDir),
        source: 'command-line',
        sourceName: '--data-dir',
      }
    : env.NOTES_DATA_DIR !== undefined
      ? {
          value: path.resolve(cwd, env.NOTES_DATA_DIR),
          source: 'environment',
          sourceName: 'NOTES_DATA_DIR',
        }
      : fileLayer.dataDir !== undefined
        ? {
            value: path.resolve(configDir.value, fileLayer.dataDir),
            source: 'config-file',
            sourceName: `${configFile}#dataDir`,
          }
        : {
            value: path.join(configDir.value, 'data'),
            source: 'default',
            sourceName: 'built-in default',
          };

  const output: EffectiveValue<OutputFormat> = opt.output !== undefined
    ? {
        value: opt.output,
        source: 'command-line',
        sourceName: opt.outputSourceName ?? '--output',
      }
    : env.NOTES_FORMAT !== undefined
      ? {
          value: env.NOTES_FORMAT,
          source: 'environment',
          sourceName: 'NOTES_FORMAT',
        }
      : fileLayer.defaultFormat !== undefined
        ? {
            value: fileLayer.defaultFormat,
            source: 'config-file',
            sourceName: `${configFile}#defaultFormat`,
          }
        : {
            value: defaults.defaultFormat,
            source: 'default',
            sourceName: 'built-in default',
          };

  const pageSize: EffectiveValue<number> = fileLayer.pageSize !== undefined
    ? {
        value: fileLayer.pageSize,
        source: 'config-file',
        sourceName: `${configFile}#pageSize`,
      }
    : {
        value: defaults.pageSize,
        source: 'default',
        sourceName: 'built-in default',
      };

  const effective: EffectiveConfig = {
    configDir,
    dataDir,
    output,
    pageSize,
  };

  return {
    configDir: configDir.value,
    configFile,
    dataDir: dataDir.value,
    output: output.value,
    pageSize: pageSize.value,
    effective,
  };
}

/**
 * 交互式初始化配置向导
 */
export async function initConfig(
  configDir?: string,
  interactive = process.stdin.isTTY === true,
): Promise<{
  configDir: string;
  dataDir: string;
  defaultFormat: 'json' | 'table';
  pageSize: number;
}> {
  const dir = path.resolve(configDir ?? DEFAULT_CONFIG_DIR);

  // 交互式提问（仅在 TTY 环境下）
  const dataDir = interactive
    ? await input({
        message: 'Where should notes be stored?',
        default: path.join(dir, 'data'),
      })
    : path.join(dir, 'data');

  const defaultFormat = interactive
    ? await select({
        message: 'Default output format:',
        choices: [
          { name: 'Table', value: 'table', description: 'Human-friendly aligned text' },
          { name: 'JSON', value: 'json', description: 'Machine-readable structured output' },
        ],
        default: 'table',
      })
    : 'table';

  const pageSizeInput = interactive
    ? await input({
        message: 'Page size:',
        default: '25',
        validate: (value) => {
          const n = parseInt(value, 10);
          return n > 0 && n <= 1000 ? true : 'Enter a number between 1 and 1000';
        },
      })
    : '25';

  const config: Config = {
    dataDir,
    defaultFormat: defaultFormat as 'json' | 'table',
    pageSize: parseInt(pageSizeInput, 10),
  };

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, CONFIG_FILE), JSON.stringify(config, null, 2), 'utf-8');
  await fs.mkdir(config.dataDir, { recursive: true });

  return {
    configDir: dir,
    dataDir: config.dataDir,
    defaultFormat: config.defaultFormat,
    pageSize: config.pageSize,
  };
}
