/**
 * 配置管理层
 * 对应 confluence-cli 的 internal/config/
 *
 * 优先级：CLI flags > 环境变量 > 配置文件 > 内置默认值
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
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
  format?: string;       // --format 标志
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
  if (opt.format === 'json' || opt.format === 'table') {
    flagLayer.defaultFormat = opt.format;
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
  sources.defaultFormat = opt.format ? 'flag' : process.env.NOTES_FORMAT ? 'env' : fileLayer.defaultFormat ? 'file' : 'default';

  return { ...merged, sources };
}

/**
 * 交互式初始化配置（简化版）
 */
export async function initConfig(configDir?: string): Promise<void> {
  const dir = configDir ?? DEFAULT_CONFIG_DIR;
  await fs.mkdir(dir, { recursive: true });

  const config: Config = {
    dataDir: path.join(dir, 'data'),
    defaultFormat: 'table',
    pageSize: 25,
  };

  await fs.writeFile(path.join(dir, CONFIG_FILE), JSON.stringify(config, null, 2), 'utf-8');

  // 同时创建数据目录
  await fs.mkdir(config.dataDir, { recursive: true });

  console.log(`Config initialized at ${dir}`);
  console.log(`Data directory: ${config.dataDir}`);
}
