import { loadConfig } from '../config/resolver.js';
import { CancellationContext } from './cancellation.js';
import { CLIError } from './errors.js';
import { createRequestId } from './execution.js';
import { emit, emitList } from './output.js';
import { parseFields, parseOutputFormat } from './parsers.js';
import type { ExecutionMode } from './execution.js';
import type { OutputOptions } from './output.js';
import type { LoadOptions } from '../config/resolver.js';

export interface GlobalFlags {
  config?: string;
  dataDir?: string;
  output?: string;
  legacyFormat?: string;
  pretty: boolean;
  fields?: string;
  quiet: boolean;
  noInput: boolean;
  interactive: boolean;
  timeout?: string;
}

export interface AppState {
  gflags: GlobalFlags;
  requestId: string;
  commandName: string;
  mode?: ExecutionMode;
  config?: Awaited<ReturnType<typeof loadConfig>>;
  exitCode: number;
  cancellation: CancellationContext;
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
  'batch',
  'doctor',
];

function readRawOption(
  argv: string[],
  longName: string,
  shortName?: string,
): string | undefined {
  const args = argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === longName || (shortName && arg === shortName)) {
      return args[index + 1];
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

export function createAppState(
  argv: string[] = process.argv,
  cancellation = new CancellationContext(),
): AppState {
  return {
    gflags: {
      output: readRawOption(argv, '--output', '-o'),
      legacyFormat: readRawOption(argv, '--format', '-f'),
      pretty: argv.slice(2).includes('--pretty'),
      fields: readRawOption(argv, '--fields'),
      quiet: argv.slice(2).includes('--quiet'),
      noInput: argv.slice(2).includes('--no-input'),
      interactive: argv.slice(2).includes('--interactive'),
      timeout: readRawOption(argv, '--timeout'),
    },
    requestId: createRequestId(),
    commandName: inferCommand(argv),
    exitCode: 0,
    cancellation,
  };
}

export function resolveOutputFlag(flags: GlobalFlags): string | undefined {
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

export function configLoadOptions(state: AppState): LoadOptions {
  const outputValue = resolveOutputFlag(state.gflags);
  return {
    configPath: state.gflags.config,
    dataDir: state.gflags.dataDir,
    output: outputValue ? parseOutputFormat(outputValue) : undefined,
    outputSourceName:
      state.gflags.output ? '--output' : state.gflags.legacyFormat ? '--format' : undefined,
  };
}

export async function ensureConfig(state: AppState): Promise<NonNullable<AppState['config']>> {
  if (state.config) return state.config;
  state.config = await loadConfig(configLoadOptions(state));
  return state.config;
}

export function makeOutputOptions(state: AppState): OutputOptions {
  if (!state.mode) {
    throw new CLIError('internal', 'MODE_NOT_RESOLVED', 'Execution mode was not resolved');
  }
  return {
    output: state.mode.output,
    pretty: state.gflags.pretty,
    quiet: state.gflags.quiet,
    command: state.commandName,
    requestId: state.requestId,
    fields: parseFields(state.gflags.fields),
  };
}

export function isHumanOutput(state: AppState): boolean {
  return state.mode?.output === 'table' && !state.gflags.quiet;
}

export class CommandContext {
  constructor(readonly state: AppState) {}

  config(): Promise<NonNullable<AppState['config']>> {
    return ensureConfig(this.state);
  }

  emit(data: unknown): void {
    emit(data, makeOutputOptions(this.state));
  }

  emitList<T>(
    items: T[],
    page: { next?: string; hasMore: boolean },
  ): void {
    emitList(items, page, makeOutputOptions(this.state));
  }

  get humanOutput(): boolean {
    return isHumanOutput(this.state);
  }

  get signal(): AbortSignal {
    return this.state.cancellation.signal;
  }
}
