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

const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.config', 'notes-cli');
const CONFIG_FILE = 'config.json';

const defaults: Config = {
  dataDir: path.join(DEFAULT_CONFIG_DIR, 'data'),
  defaultFormat: 'table',
  pageSize: 25,
};

export interface LoadOptions {
  configPath?: string;   // --config 指定的目录
  dataDir?: string;      // --data-dir 标志
  output?: string;       // --output 标志
}

export interface ResolvedConfig extends Config {
  sources: Record<string, string>; // 记录每个字段的来源
}

function resolveConfigDir(opt: LoadOptions): string {
  return opt.configPath ?? DEFAULT_CONFIG_DIR;
}

async function readConfigFile(configDir: string): Promise<Partial<Config>> {
  const fp = path.join(configDir, CONFIG_FILE);
  try {
    const raw = await fs.readFile(fp, 'utf-8');
    return JSON.parse(raw) as Partial<Config>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw new CLIError(
      'config',
      'CONFIG_READ_ERROR',
      `Failed to read config: ${(err as Error).message}`,
    );
  }
}

/**
 * 合并多层配置
 */
export async function loadConfig(opt: LoadOptions): Promise<ResolvedConfig> {
  const configDir = resolveConfigDir(opt);

  // 第 1 层：文件
  const fileLayer = await readConfigFile(configDir);

  // 第 2 层：环境变量
  const envLayer: Partial<Config> = {};
  if (process.env.NOTES_DATA_DIR) envLayer.dataDir = process.env.NOTES_DATA_DIR;
  if (process.env.NOTES_FORMAT) {
    const f = process.env.NOTES_FORMAT;
    if (f === 'json' || f === 'table') envLayer.defaultFormat = f;
  }

  // 第 3 层：CLI flags
  const flagLayer: Partial<Config> = {};
  if (opt.dataDir) flagLayer.dataDir = opt.dataDir;
  if (opt.output === 'json' || opt.output === 'table') {
    flagLayer.defaultFormat = opt.output;
  }

  // 合并（后面的覆盖前面的）
  const merged: Config = {
    dataDir: flagLayer.dataDir ?? envLayer.dataDir ?? fileLayer.dataDir ?? defaults.dataDir,
    defaultFormat:
      flagLayer.defaultFormat ?? envLayer.defaultFormat ?? fileLayer.defaultFormat ?? defaults.defaultFormat,
    pageSize: fileLayer.pageSize ?? defaults.pageSize,
  };

  const sources: Record<string, string> = {};
  sources.dataDir = opt.dataDir ? 'flag' : process.env.NOTES_DATA_DIR ? 'env' : fileLayer.dataDir ? 'file' : 'default';
  sources.defaultFormat = opt.output ? 'flag' : process.env.NOTES_FORMAT ? 'env' : fileLayer.defaultFormat ? 'file' : 'default';

  return { ...merged, sources };
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
  const dir = configDir ?? DEFAULT_CONFIG_DIR;

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
