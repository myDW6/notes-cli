/**
 * 命令树定义
 * 对应 confluence-cli 的 internal/app/ 下的所有命令文件
 *
 * 用 commander 构建命令树，每个命令的 RunE 对应一个处理函数。
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { input, select } from '@inquirer/prompts';
import { loadConfig, initConfig } from './config.js';
import {
  listNotes,
  getNote,
  createNote,
  updateNote,
  deleteNote,
  searchNotes,
  describeCreate,
  describeDelete,
  exportNotes,
  exportNotesCSV,
} from './storage.js';
import { emit, emitList, emitError, setGlobalPretty } from './output.js';
import { CLIError, exitCode, isCLIError } from './errors.js';
import type { OutputOptions } from './output.js';

// ---------- 共享状态 ----------

interface GlobalFlags {
  config?: string;
  dataDir?: string;
  format?: string;
  pretty: boolean;
}

interface AppState {
  gflags: GlobalFlags;
  configLoaded: boolean;
  _config?: Awaited<ReturnType<typeof loadConfig>>;
}

function newAppState(): AppState {
  return { gflags: { pretty: false }, configLoaded: false };
}

async function ensureConfig(s: AppState): Promise<NonNullable<AppState['_config']>> {
  if (s._config) return s._config;
  s._config = await loadConfig({
    configPath: s.gflags.config,
    dataDir: s.gflags.dataDir,
    format: s.gflags.format,
  });
  s.configLoaded = true;
  return s._config;
}

function makeOutputOptions(s: AppState): OutputOptions {
  const cfg = s._config;
  const format = (s.gflags.format as 'json' | 'table') ?? cfg?.defaultFormat ?? 'table';
  return {
    format,
    pretty: s.gflags.pretty,
  };
}

// ---------- 命令构建 ----------

export function buildCLI(): Command {
  const state = newAppState();

  const program = new Command();
  program
    .name('notes')
    .description('A CLI for managing local notes')
    .version('1.0.0')
    .configureOutput({ writeErr: (str) => process.stderr.write(str) })
    // 全局持久化选项（对应 cobra 的 PersistentFlags）
    .option('-c, --config <path>', 'config directory')
    .option('--data-dir <path>', 'data directory (overrides config)')
    .option('-f, --format <fmt>', 'output format: json or table')
    .option('--pretty', 'colorize JSON output', false)
    .hook('preAction', async (thisCommand) => {
      // 在每个命令执行前：解析全局选项并加载配置
      const opts = thisCommand.opts();
      state.gflags = {
        config: opts.config,
        dataDir: opts.dataDir,
        format: opts.format,
        pretty: opts.pretty,
      };
      setGlobalPretty(opts.pretty);
      await ensureConfig(state);
    });

  // --- notes list ---
  program
    .command('list')
    .description('List all notes')
    .option('-l, --limit <n>', 'page size', '25')
    .option('--cursor <cursor>', 'pagination cursor')
    .option('--all', 'fetch all pages', false)
    .action(async (options) => {
      const cfg = await ensureConfig(state);
      const limit = parseInt(options.limit, 10);
      const cursor = options.cursor as string | undefined;

      if (options.all) {
        // 收集所有分页
        const allItems: Awaited<ReturnType<typeof listNotes>>['items'] = [];
        let c: string | undefined = cursor;
        while (true) {
          const page = await listNotes(cfg.dataDir, { limit, cursor: c });
          allItems.push(...page.items);
          if (!page.hasMore) break;
          c = page.next;
        }
        emit(allItems, makeOutputOptions(state));
      } else {
        const page = await listNotes(cfg.dataDir, { limit, cursor });
        emitList(page.items, { hasMore: page.hasMore, next: page.next }, makeOutputOptions(state));
      }
    });

  // --- notes get <id> ---
  program
    .command('get <id>')
    .description('Get a note by ID')
    .action(async (id: string) => {
      const cfg = await ensureConfig(state);
      const note = await getNote(cfg.dataDir, id);
      emit(note, makeOutputOptions(state));
    });

  // --- notes create ---
  program
    .command('create')
    .description('Create a new note')
    .option('-t, --title <title>', 'note title')
    .option('--content <content>', 'note content')
    .option('--tags <tags>', 'comma-separated tags')
    .option('--dry-run', 'preview the request without creating', false)
    .action(async (options) => {
      const cfg = await ensureConfig(state);

      // 交互式补全：如果没传参数，用 TUI 提问
      const title = options.title ?? await input({ message: 'Note title:' });
      const content = options.content ?? await input({ message: 'Content:' });
      const tagsRaw = options.tags ?? await input({ message: 'Tags (optional):' });

      const req = {
        title: title as string,
        content: content as string,
        tags: tagsRaw ? String(tagsRaw).split(',').map((s: string) => s.trim()).filter(Boolean) : [],
      };

      if (options.dryRun) {
        emit({ plan: describeCreate(req) }, makeOutputOptions(state));
        return;
      }

      const note = await createNote(cfg.dataDir, req);
      console.log(chalk.green('✓'), 'Note created:', chalk.bold(note.id));
      emit(note, makeOutputOptions(state));
    });

  // --- notes update <id> ---
  program
    .command('update <id>')
    .description('Update an existing note')
    .option('-t, --title <title>', 'new title')
    .option('--content <content>', 'new content')
    .option('--tags <tags>', 'comma-separated tags')
    .option('--dry-run', 'preview the request without updating', false)
    .action(async (id: string, options) => {
      const cfg = await ensureConfig(state);
      const req = {
        id,
        title: options.title as string | undefined,
        content: options.content as string | undefined,
        tags: options.tags ? String(options.tags).split(',').map((s: string) => s.trim()) : undefined,
      };

      if (options.dryRun) {
        emit({ plan: { action: 'update', id, ...req } }, makeOutputOptions(state));
        return;
      }

      const note = await updateNote(cfg.dataDir, req);
      emit(note, makeOutputOptions(state));
    });

  // --- notes delete <id> ---
  program
    .command('delete <id>')
    .description('Delete a note')
    .option('--yes', 'confirm deletion without prompt', false)
    .option('--dry-run', 'preview the request without deleting', false)
    .action(async (id: string, options) => {
      const cfg = await ensureConfig(state);

      if (options.dryRun) {
        emit({ plan: describeDelete(id) }, makeOutputOptions(state));
        return;
      }

      if (!options.yes) {
        throw new CLIError(
          'usage',
          'CONFIRM_REQUIRED',
          'Deletion requires confirmation. Pass --yes to confirm.',
          'This is a destructive operation.',
          [`notes delete ${id} --yes`],
        );
      }

      await deleteNote(cfg.dataDir, id);
      emit({ deleted: true, id }, makeOutputOptions(state));
    });

  // --- notes search <keyword> ---
  program
    .command('search <keyword>')
    .description('Search notes by keyword')
    .action(async (keyword: string) => {
      const cfg = await ensureConfig(state);
      const hits = await searchNotes(cfg.dataDir, keyword);
      emit(hits, makeOutputOptions(state));
    });

  // --- notes export [path] ---
  program
    .command('export [path]')
    .description('Export all notes to a file')
    .option('--export-format <fmt>', 'export file format: json or csv')
    .option('--dry-run', 'preview the export without writing', false)
    .action(async (pathArg: string | undefined, options) => {
      const cfg = await ensureConfig(state);

      // 交互式选择导出格式
      let exportFormat = options.exportFormat as string | undefined;
      if (!exportFormat && process.stdin.isTTY) {
        exportFormat = await select({
          message: 'Export format:',
          choices: [
            { name: 'JSON', value: 'json', description: 'Structured JSON with metadata' },
            { name: 'CSV', value: 'csv', description: 'Comma-separated values' },
          ],
        });
      }
      exportFormat = exportFormat ?? 'json';

      const filePath = pathArg ?? `notes-export.${exportFormat}`;

      if (options.dryRun) {
        const notes = await listNotes(cfg.dataDir, { limit: 9999 });
        emit({
          plan: {
            action: 'export',
            filePath,
            format: exportFormat,
            count: notes.items.length,
          },
        }, makeOutputOptions(state));
        return;
      }

      const result =
        exportFormat === 'csv'
          ? await exportNotesCSV(cfg.dataDir, filePath)
          : await exportNotes(cfg.dataDir, filePath);

      console.log(chalk.green('✓'), `Exported ${chalk.bold(result.count)} notes to ${chalk.bold(filePath)}`);
      emit(result, makeOutputOptions(state));
    });

  // --- notes config init ---
  program
    .command('config init')
    .description('Initialize configuration')
    .action(async () => {
      await initConfig(state.gflags.config);
    });

  return program;
}

/**
 * 执行 CLI，返回退出码
 * 对应 confluence-cli 的 app.Execute()
 */
export async function execute(argv: string[]): Promise<number> {
  const program = buildCLI();

  try {
    await program.parseAsync(argv);
    return 0;
  } catch (err) {
    const ce = isCLIError(err) ? err : new CLIError('internal', 'INTERNAL', (err as Error).message);
    emitError(ce);
    return exitCode(ce.category);
  }
}
