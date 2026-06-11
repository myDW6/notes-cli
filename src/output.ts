/**
 * 输出格式化层
 * 对应 confluence-cli 的 internal/output/
 */
import chalk from 'chalk';
import type { CLIError } from './errors.js';

export const API_VERSION = 'notes.cli/v1' as const;

export type OutputFormat = 'json' | 'jsonl' | 'table';

export interface OutputOptions {
  output: OutputFormat;
  pretty: boolean;
  command: string;
  requestId: string;
  fields?: string[]; // dot-path 字段过滤，如 ["id", "title"]
}

export interface ErrorOutputOptions {
  command: string;
  requestId: string;
  pretty: boolean;
}

/**
 * 把任意数据渲染为 JSON 或表格
 */
export function emit(data: unknown, opt: OutputOptions): void {
  const projected = opt.fields && opt.fields.length > 0
    ? projectFields(data, opt.fields)
    : data;

  if (opt.output === 'table') {
    emitTable(projected, opt);
  } else {
    emitJSON({
      ok: true,
      apiVersion: API_VERSION,
      command: opt.command,
      requestId: opt.requestId,
      data: projected,
    }, opt.pretty && opt.output === 'json');
  }
}

/**
 * 列表输出：统一包装为 { items, has_more, next? }
 */
export function emitList<T>(
  items: T[],
  info: { next?: string; hasMore: boolean },
  opt: OutputOptions,
): void {
  if (opt.output === 'table') {
    emitTable(items, opt);
    if (info.hasMore && info.next) {
      console.log(chalk.gray(`\n(more results - re-run with --cursor ${info.next})`));
    }
  } else {
    const page: Record<string, unknown> = { hasMore: info.hasMore };
    if (info.next) page.nextCursor = info.next;
    emit({
      items,
      page,
    }, opt);
  }
}

/**
 * 错误输出到 stderr（始终 JSON）
 */
export function emitError(err: CLIError, opt: ErrorOutputOptions): void {
  const json = JSON.stringify({
    ok: false,
    apiVersion: API_VERSION,
    command: opt.command,
    requestId: opt.requestId,
    ...err.toJSON(),
  }, null, opt.pretty ? 2 : undefined);
  console.error(json);
}

function emitJSON(data: unknown, pretty: boolean): void {
  console.log(JSON.stringify(data, null, pretty ? 2 : undefined));
}

function emitTable(data: unknown, _opt: OutputOptions): void {
  if (!Array.isArray(data)) {
    // 单条记录直接打 JSON，或者可以做成 key-value 表格
    emitJSON(data, false);
    return;
  }
  if (data.length === 0) {
    console.log(chalk.gray('(no results)'));
    return;
  }

  // 简单表格：提取所有对象的 key 作为表头
  const keys = Object.keys(data[0] as object);
  const widths = keys.map((k) =>
    Math.max(k.length, ...data.map((row) => String((row as Record<string, unknown>)[k] ?? '').length)),
  );

  // 表头
  const header = keys.map((k, i) => chalk.bold.cyan(k.padEnd(widths[i]))).join('  ');
  console.log(header);
  console.log(keys.map((_, i) => '-'.repeat(widths[i])).join('  '));

  // 数据行
  for (const row of data) {
    const line = keys
      .map((k, i) => String((row as Record<string, unknown>)[k] ?? '').padEnd(widths[i]))
      .join('  ');
    console.log(line);
  }
}

/**
 * 简单的字段投影（支持一层 dot-path）
 */
function projectFields(data: unknown, fields: string[]): unknown {
  if (Array.isArray(data)) {
    return data.map((item) => projectFields(item, fields));
  }
  if (typeof data !== 'object' || data === null) return data;

  const result: Record<string, unknown> = {};
  for (const f of fields) {
    if (f in data) result[f] = (data as Record<string, unknown>)[f];
  }
  return result;
}
