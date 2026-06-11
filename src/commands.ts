/**
 * 命令树定义
 * 对应 confluence-cli 的 internal/app/ 下的所有命令文件
 *
 * Commander 只负责参数解析；这里同时维护 CLI 的输入、输出和交互契约。
 */
import fs from 'node:fs/promises';
import { Command, CommanderError, Option } from 'commander';
import chalk from 'chalk';
import { confirm, input, select } from '@inquirer/prompts';
import { loadConfig, initConfig } from './config.js';
import {
  listNotes,
  getNote,
  createNote,
  createNoteIdempotent,
  updateNote,
  deleteNote,
  searchNotes,
  describeCreate,
  describeDelete,
  exportNotes,
  exportNotesCSV,
} from './storage.js';
import { emit, emitList, emitError } from './output.js';
import { CLIError, exitCode, isCLIError } from './errors.js';
import { createRequestId, resolveExecutionMode } from './execution.js';
import { requestFingerprint } from './idempotency.js';
import {
  CLI_CAPABILITIES,
  CREATE_NOTE_INPUT_SCHEMA,
  validateCreateInput,
} from './discovery.js';
import type { ExecutionMode } from './execution.js';
import type { OutputFormat, OutputOptions } from './output.js';
import type { CreateNoteReq } from './types.js';

interface GlobalFlags {
  config?: string;
  dataDir?: string;
  output?: string;
  legacyFormat?: string;
  pretty: boolean;
  noInput: boolean;
  interactive: boolean;
}

interface AppState {
  gflags: GlobalFlags;
  requestId: string;
  commandName: string;
  mode?: ExecutionMode;
  _config?: Awaited<ReturnType<typeof loadConfig>>;
}

const COMMAND_NAMES = [
  'list',
  'get',
  'create',
  'update',
  'delete',
  'search',
  'export',
  'interactive-edit',
  'config',
  'capabilities',
  'schema',
];

function readRawOption(argv: string[], longName: string, shortName?: string): string | undefined {
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === longName || (shortName && arg === shortName)) {
      return args[i + 1];
    }
    if (arg.startsWith(`${longName}=`)) {
      return arg.slice(longName.length + 1);
    }
  }
  return undefined;
}

function inferCommand(argv: string[]): string {
  return argv.slice(2).find((arg) => COMMAND_NAMES.includes(arg)) ?? 'notes';
}

function newAppState(argv: string[] = process.argv): AppState {
  return {
    gflags: {
      output: readRawOption(argv, '--output', '-o'),
      legacyFormat: readRawOption(argv, '--format', '-f'),
      pretty: argv.slice(2).includes('--pretty'),
      noInput: argv.slice(2).includes('--no-input'),
      interactive: argv.slice(2).includes('--interactive'),
    },
    requestId: createRequestId(),
    commandName: inferCommand(argv),
  };
}

function parseOutputFormat(value: string): OutputFormat {
  if (value === 'table' || value === 'json' || value === 'jsonl') {
    return value;
  }
  throw new CLIError(
    'usage',
    'INVALID_ARGUMENT',
    '--output must be one of: table, json, jsonl',
    '',
    [],
    { argument: 'output', value, expected: ['table', 'json', 'jsonl'] },
  );
}

function resolveOutputFlag(flags: GlobalFlags): string | undefined {
  if (flags.output && flags.legacyFormat && flags.output !== flags.legacyFormat) {
    throw new CLIError(
      'usage',
      'CONFLICTING_OPTIONS',
      '--output cannot be combined with a different --format value',
      '',
      [],
      { options: ['output', 'format'] },
    );
  }
  return flags.output ?? flags.legacyFormat;
}

async function ensureConfig(s: AppState): Promise<NonNullable<AppState['_config']>> {
  if (s._config) return s._config;
  const output = resolveOutputFlag(s.gflags);
  if (output) parseOutputFormat(output);
  s._config = await loadConfig({
    configPath: s.gflags.config,
    dataDir: s.gflags.dataDir,
    output,
  });
  return s._config;
}

function makeOutputOptions(s: AppState): OutputOptions {
  if (!s.mode) {
    throw new CLIError('internal', 'MODE_NOT_RESOLVED', 'Execution mode was not resolved');
  }
  return {
    output: s.mode.output,
    pretty: s.gflags.pretty,
    command: s.commandName,
    requestId: s.requestId,
  };
}

function isHumanOutput(s: AppState): boolean {
  return s.mode?.output === 'table';
}

function parseLimit(raw: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new CLIError(
      'usage',
      'INVALID_ARGUMENT',
      '--limit must be an integer between 1 and 1000',
      '',
      [],
      { argument: 'limit', value: raw, expected: 'integer between 1 and 1000' },
    );
  }
  const value = Number(raw);
  if (value < 1 || value > 1000) {
    throw new CLIError(
      'usage',
      'INVALID_ARGUMENT',
      '--limit must be an integer between 1 and 1000',
      '',
      [],
      { argument: 'limit', value: raw, expected: 'integer between 1 and 1000' },
    );
  }
  return value;
}

function parseTags(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(',').map((tag) => tag.trim()).filter(Boolean);
}

function normalizeIdempotencyKey(raw: string): string {
  const key = raw.trim();
  if (key.length < 1 || key.length > 200) {
    throw new CLIError(
      'usage',
      'INVALID_ARGUMENT',
      '--idempotency-key must contain between 1 and 200 characters',
      '',
      [],
      {
        argument: 'idempotency-key',
        valueLength: key.length,
        expected: '1 to 200 characters',
      },
    );
  }
  return key;
}

async function readCreateInput(inputPath: string): Promise<CreateNoteReq> {
  let raw: string;
  try {
    raw = inputPath === '-'
      ? await readStdin()
      : await fs.readFile(inputPath, 'utf-8');
  } catch (err) {
    throw new CLIError(
      'usage',
      'INPUT_READ_ERROR',
      `Failed to read create input: ${(err as Error).message}`,
      '',
      [],
      { path: inputPath },
    );
  }

  try {
    return validateCreateInput(JSON.parse(raw) as unknown);
  } catch (err) {
    if (isCLIError(err)) throw err;
    throw new CLIError(
      'usage',
      'INVALID_INPUT_JSON',
      'Create input is not valid JSON',
      '',
      [],
      { path: inputPath },
    );
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

async function resolveCreateRequest(options: {
  title?: string;
  content?: string;
  tags?: string;
  input?: string;
}, state: AppState): Promise<CreateNoteReq> {
  const hasFieldInput =
    options.title !== undefined ||
    options.content !== undefined ||
    options.tags !== undefined;

  if (options.input && hasFieldInput) {
    throw new CLIError(
      'usage',
      'CONFLICTING_INPUT',
      '--input cannot be combined with --title, --content or --tags',
      '',
      [],
      { inputSources: ['input', 'field-options'] },
    );
  }

  if (options.input) {
    return readCreateInput(options.input);
  }

  let title = options.title;
  let content = options.content;
  let tagsRaw = options.tags;

  if (title === undefined && state.mode?.interactive) {
    title = await input({ message: 'Note title:' });
  }

  if (title === undefined || title.trim() === '') {
    throw new CLIError(
      'usage',
      'MISSING_REQUIRED_INPUT',
      'title is required',
      '',
      [],
      { field: 'title' },
    );
  }

  if (!hasFieldInput && state.mode?.interactive) {
    content = await input({ message: 'Content:' });
    tagsRaw = await input({ message: 'Tags (optional):' });
  }

  return {
    title: title.trim(),
    content: content ?? '',
    tags: parseTags(tagsRaw),
  };
}

export function buildCLI(state: AppState = newAppState()): Command {
  const program = new Command();
  program
    .name('notes')
    .description('A CLI for managing local notes')
    .version('1.0.0')
    .exitOverride()
    .configureOutput({
      writeErr: () => {
        // Commander parse errors are converted to the structured error protocol in execute().
      },
    })
    .configureHelp({ showGlobalOptions: true })
    .option('-c, --config <path>', 'config directory')
    .option('--data-dir <path>', 'data directory (overrides config)')
    .option('-o, --output <format>', 'output format: table, json or jsonl')
    .addOption(new Option('-f, --format <format>').hideHelp())
    .option('--pretty', 'pretty-print JSON output', false)
    .option('--no-input', 'disable interactive prompts')
    .option('--interactive', 'require interactive prompts', false)
    .hook('preAction', async (_thisCommand, actionCommand) => {
      const opts = actionCommand.optsWithGlobals();
      state.commandName = actionCommand.parent?.name() === 'schema'
        ? `schema.${actionCommand.name()}`
        : actionCommand.name();
      state.gflags = {
        config: opts.config,
        dataDir: opts.dataDir,
        output: opts.output,
        legacyFormat: opts.format,
        pretty: opts.pretty,
        noInput: opts.input === false,
        interactive: opts.interactive,
      };

      const outputValue = resolveOutputFlag(state.gflags);
      const isDiscoveryCommand =
        state.commandName === 'capabilities' ||
        state.commandName.startsWith('schema.');
      const output = outputValue
        ? parseOutputFormat(outputValue)
        : isDiscoveryCommand
          ? 'table'
          : (await ensureConfig(state)).defaultFormat;

      if (output === 'jsonl' && state.gflags.pretty) {
        throw new CLIError(
          'usage',
          'CONFLICTING_OPTIONS',
          '--pretty cannot be combined with --output jsonl',
          '',
          [],
          { options: ['pretty', 'output'], output },
        );
      }

      state.mode = resolveExecutionMode({
        output,
        noInput: state.gflags.noInput,
        interactive: state.gflags.interactive,
        stdinIsTTY: process.stdin.isTTY,
        stdoutIsTTY: process.stdout.isTTY,
      });
    });

  program
    .command('capabilities')
    .description('Describe CLI capabilities for automated clients')
    .action(() => {
      emit(CLI_CAPABILITIES, makeOutputOptions(state));
    });

  const schema = program
    .command('schema')
    .description('Describe structured input schemas');

  schema
    .command('create')
    .description('Show the JSON Schema accepted by notes create --input')
    .action(() => {
      emit(CREATE_NOTE_INPUT_SCHEMA, makeOutputOptions(state));
    });

  program
    .command('list')
    .description('List notes')
    .option('-l, --limit <n>', 'page size')
    .option('--cursor <cursor>', 'opaque pagination cursor')
    .option('--all', 'fetch all pages', false)
    .action(async (options) => {
      const cfg = await ensureConfig(state);
      const limit = parseLimit(options.limit ?? String(cfg.pageSize));
      const cursor = options.cursor as string | undefined;

      if (options.all && cursor) {
        throw new CLIError(
          'usage',
          'CONFLICTING_OPTIONS',
          '--all cannot be combined with --cursor',
          '',
          [],
          { options: ['all', 'cursor'] },
        );
      }

      if (options.all) {
        const allItems: Awaited<ReturnType<typeof listNotes>>['items'] = [];
        let next: string | undefined;
        do {
          const page = await listNotes(cfg.dataDir, { limit, cursor: next });
          allItems.push(...page.items);
          next = page.next;
        } while (next);
        emitList(allItems, { hasMore: false }, makeOutputOptions(state));
        return;
      }

      const page = await listNotes(cfg.dataDir, { limit, cursor });
      emitList(page.items, { hasMore: page.hasMore, next: page.next }, makeOutputOptions(state));
    });

  program
    .command('get <id>')
    .description('Get a note by ID')
    .action(async (id: string) => {
      const cfg = await ensureConfig(state);
      emit(await getNote(cfg.dataDir, id), makeOutputOptions(state));
    });

  program
    .command('create')
    .description('Create a note using field options, JSON input, or interactive input')
    .option('-t, --title <title>', 'note title')
    .option('--content <content>', 'note content')
    .option('--tags <tags>', 'comma-separated tags')
    .option('--input <path|->', 'read JSON input; use "-" for stdin')
    .option('--idempotency-key <key>', 'deduplicate retries of the same create request')
    .option('--dry-run', 'validate and preview without writing', false)
    .addHelpText('after', `
Examples:
  notes create --title "CLI Design"
  notes create --input note.json
  cat note.json | notes create --input - --output json
`)
    .action(async (options) => {
      const cfg = await ensureConfig(state);
      const req = await resolveCreateRequest(options, state);
      const idempotencyKey = options.idempotencyKey
        ? normalizeIdempotencyKey(String(options.idempotencyKey))
        : undefined;

      if (options.dryRun) {
        emit({
          operation: 'create',
          executed: false,
          willWrite: true,
          normalizedInput: req,
          plan: describeCreate(req),
          ...(idempotencyKey
            ? {
                idempotency: {
                  key: idempotencyKey,
                  fingerprint: requestFingerprint(req),
                  stored: false,
                },
              }
            : {}),
        }, makeOutputOptions(state));
        return;
      }

      const result = idempotencyKey
        ? await createNoteIdempotent(cfg.dataDir, req, idempotencyKey)
        : undefined;
      const note = result?.note ?? await createNote(cfg.dataDir, req);
      if (isHumanOutput(state)) {
        console.log(
          chalk.green(result?.idempotency.replayed ? 'Replayed note' : 'Created note'),
          chalk.bold(note.id),
        );
      }
      emit(
        result
          ? { ...note, idempotency: result.idempotency }
          : note,
        makeOutputOptions(state),
      );
    });

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
        tags: options.tags ? parseTags(String(options.tags)) : undefined,
      };

      if (options.dryRun) {
        emit({
          operation: 'update',
          executed: false,
          willWrite: true,
          normalizedInput: req,
        }, makeOutputOptions(state));
        return;
      }

      emit(await updateNote(cfg.dataDir, req), makeOutputOptions(state));
    });

  program
    .command('delete <id>')
    .description('Delete a note')
    .option('--yes', 'confirm deletion without prompting', false)
    .option('--dry-run', 'preview the request without deleting', false)
    .action(async (id: string, options) => {
      const cfg = await ensureConfig(state);

      if (options.dryRun) {
        emit({
          operation: 'delete',
          executed: false,
          willWrite: true,
          plan: describeDelete(id),
        }, makeOutputOptions(state));
        return;
      }

      if (!options.yes) {
        if (!state.mode?.interactive) {
          throw new CLIError(
            'usage',
            'CONFIRMATION_REQUIRED',
            'Deletion requires confirmation in non-interactive mode',
            'Pass --yes to confirm this destructive operation.',
            [`notes delete ${id} --yes`],
            { id },
          );
        }
        const accepted = await confirm({
          message: `Delete note "${id}"?`,
          default: false,
        });
        if (!accepted) {
          emit({ deleted: false, id }, makeOutputOptions(state));
          return;
        }
      }

      await deleteNote(cfg.dataDir, id);
      emit({ deleted: true, id }, makeOutputOptions(state));
    });

  program
    .command('search <keyword>')
    .description('Search notes by keyword')
    .action(async (keyword: string) => {
      const cfg = await ensureConfig(state);
      emit({ items: await searchNotes(cfg.dataDir, keyword) }, makeOutputOptions(state));
    });

  program
    .command('export [path]')
    .description('Export all notes to a file')
    .option('--export-format <format>', 'export file format: json or csv')
    .option('--dry-run', 'preview the export without writing', false)
    .action(async (pathArg: string | undefined, options) => {
      const cfg = await ensureConfig(state);
      let exportFormat = options.exportFormat as string | undefined;
      if (!exportFormat && state.mode?.interactive) {
        exportFormat = await select({
          message: 'Export format:',
          choices: [
            { name: 'JSON', value: 'json', description: 'Structured JSON with metadata' },
            { name: 'CSV', value: 'csv', description: 'Comma-separated values' },
          ],
        });
      }
      exportFormat = exportFormat ?? 'json';
      if (exportFormat !== 'json' && exportFormat !== 'csv') {
        throw new CLIError(
          'usage',
          'INVALID_ARGUMENT',
          '--export-format must be json or csv',
          '',
          [],
          { argument: 'export-format', value: exportFormat, expected: ['json', 'csv'] },
        );
      }

      const filePath = pathArg ?? `notes-export.${exportFormat}`;
      if (options.dryRun) {
        const notes = await listNotes(cfg.dataDir, { limit: 1000 });
        emit({
          operation: 'export',
          executed: false,
          willWrite: true,
          filePath,
          format: exportFormat,
          count: notes.items.length,
        }, makeOutputOptions(state));
        return;
      }

      const result = exportFormat === 'csv'
        ? await exportNotesCSV(cfg.dataDir, filePath)
        : await exportNotes(cfg.dataDir, filePath);

      if (isHumanOutput(state)) {
        console.log(`Exported ${result.count} notes to ${filePath}`);
      }
      emit(result, makeOutputOptions(state));
    });

  program
    .command('interactive-edit')
    .description('Interactively select and edit a note')
    .action(async () => {
      if (!state.mode?.interactive) {
        throw new CLIError(
          'usage',
          'TTY_REQUIRED',
          'interactive-edit requires interactive mode',
          'This command uses prompts that need a real terminal.',
          ['notes update <id> --title "..." --content "..."'],
        );
      }

      const cfg = await ensureConfig(state);
      const { items } = await listNotes(cfg.dataDir, { limit: 1000 });
      if (items.length === 0) {
        console.log(chalk.yellow('No notes to edit.'));
        return;
      }

      const selectedId = await select({
        message: 'Select a note to edit:',
        choices: items.map((note) => ({
          name: `${note.title}  ${chalk.gray(`[${note.tags.join(', ') || 'no tags'}]`)}`,
          value: note.id,
          description:
            note.content.slice(0, 60).replace(/\n/g, ' ') +
            (note.content.length > 60 ? '...' : ''),
        })),
      });
      const note = await getNote(cfg.dataDir, selectedId);
      const title = await input({ message: `New title (keep "${note.title}"):` });
      const content = await input({ message: 'New content (keep current):' });
      const tagsRaw = await input({
        message: `New tags (keep "${note.tags.join(', ') || 'none'}"):`,
      });

      const req: { id: string; title?: string; content?: string; tags?: string[] } = {
        id: selectedId,
      };
      if (title.trim()) req.title = title.trim();
      if (content.trim()) req.content = content.trim();
      const tags = parseTags(tagsRaw);
      if (tags.length > 0 && JSON.stringify(tags) !== JSON.stringify(note.tags)) {
        req.tags = tags;
      }

      if (Object.keys(req).length <= 1) {
        console.log(chalk.gray('No changes made.'));
        return;
      }

      const updated = await updateNote(cfg.dataDir, req);
      console.log('Updated note', chalk.bold(updated.id));
      emit(updated, makeOutputOptions(state));
    });

  program
    .command('config init')
    .description('Initialize configuration')
    .action(async () => {
      const result = await initConfig(state.gflags.config, state.mode?.interactive === true);
      emit(result, makeOutputOptions(state));
    });

  return program;
}

export async function execute(argv: string[]): Promise<number> {
  const state = newAppState(argv);
  const program = buildCLI(state);

  try {
    await program.parseAsync(argv);
    return 0;
  } catch (err) {
    if (
      err instanceof CommanderError &&
      (err.code === 'commander.helpDisplayed' || err.code === 'commander.version')
    ) {
      return 0;
    }

    const ce = isCLIError(err)
      ? err
      : err instanceof CommanderError
        ? new CLIError(
            'usage',
            'INVALID_COMMAND_USAGE',
            err.message,
            '',
            [],
            { commanderCode: err.code },
          )
        : new CLIError('internal', 'INTERNAL', (err as Error).message);

    emitError(ce, {
      command: state.commandName,
      requestId: state.requestId,
      pretty: state.gflags.pretty,
    });
    return exitCode(ce.category);
  }
}
