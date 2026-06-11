import { Option } from 'commander';
import { CLIError } from './errors.js';
import { resolveExecutionMode } from './execution.js';
import { parseDuration, parseFields, parseOutputFormat } from './parsers.js';
import { deprecatedOption } from '../protocol/deprecations.js';
import { ensureConfig, isHumanOutput, resolveOutputFlag } from './runtime.js';
import type { Command } from 'commander';
import type { AppState } from './runtime.js';

function commandPath(program: Command, actionCommand: Command): string {
  return actionCommand.parent !== program && actionCommand.parent
    ? `${actionCommand.parent.name()}.${actionCommand.name()}`
    : actionCommand.name();
}

function validateOutputOptions(state: AppState, output: string): void {
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
  if (state.gflags.quiet && output !== 'table') {
    throw new CLIError(
      'usage',
      'CONFLICTING_OPTIONS',
      '--quiet can only be used with --output table',
      '',
      [],
      { options: ['quiet', 'output'], output },
    );
  }
  if (state.gflags.fields && output === 'jsonl') {
    throw new CLIError(
      'usage',
      'CONFLICTING_OPTIONS',
      '--fields cannot be combined with --output jsonl',
      '',
      [],
      { options: ['fields', 'output'], output },
    );
  }
  parseFields(state.gflags.fields);
}

function emitDeprecationWarnings(state: AppState): void {
  if (!state.gflags.legacyFormat || !isHumanOutput(state)) return;
  const deprecation = deprecatedOption('--format');
  if (!deprecation) return;
  console.error(
    `Warning [DEPRECATED_OPTION]: ${deprecation.name} is deprecated; ` +
    `use ${deprecation.replacement}. It will be removed in ${deprecation.removalVersion}.`,
  );
}

export function configureProgram(program: Command, state: AppState): void {
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
    .option('--fields <fields>', 'comma-separated fields to include in result data')
    .option('--quiet', 'suppress successful human-readable output', false)
    .option('--no-input', 'disable interactive prompts')
    .option('--interactive', 'require interactive prompts', false)
    .option('--timeout <duration>', 'cancel after a duration such as 500ms, 30s or 5m')
    .hook('preAction', async (_thisCommand, actionCommand) => {
      const opts = actionCommand.optsWithGlobals();
      state.commandName = commandPath(program, actionCommand);
      state.gflags = {
        config: opts.config,
        dataDir: opts.dataDir,
        output: opts.output,
        legacyFormat: opts.format,
        pretty: opts.pretty,
        fields: opts.fields,
        quiet: opts.quiet,
        noInput: opts.input === false,
        interactive: opts.interactive,
        timeout: opts.timeout,
      };

      if (state.gflags.timeout) {
        state.cancellation.armTimeout(parseDuration(state.gflags.timeout));
      }
      state.cancellation.throwIfAborted();

      const outputValue = resolveOutputFlag(state.gflags);
      const isConfigIndependentCommand =
        state.commandName === 'capabilities' ||
        state.commandName.startsWith('schema.') ||
        state.commandName === 'doctor';
      const output = outputValue
        ? parseOutputFormat(outputValue)
        : isConfigIndependentCommand
          ? 'table'
          : (await ensureConfig(state)).output;

      validateOutputOptions(state, output);
      state.mode = resolveExecutionMode({
        output,
        noInput: state.gflags.noInput,
        interactive: state.gflags.interactive,
        stdinIsTTY: process.stdin.isTTY,
        stdoutIsTTY: process.stdout.isTTY,
      });
    })
    .hook('postAction', () => {
      emitDeprecationWarnings(state);
    });
}
