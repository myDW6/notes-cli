import { Option } from 'commander';
import { CLIError } from './errors.js';
import { resolveExecutionMode } from './execution.js';
import { parseFields, parseOutputFormat } from './parsers.js';
import { ensureConfig, resolveOutputFlag } from './runtime.js';
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
      };

      const outputValue = resolveOutputFlag(state.gflags);
      const isDiscoveryCommand =
        state.commandName === 'capabilities' ||
        state.commandName.startsWith('schema.');
      const output = outputValue
        ? parseOutputFormat(outputValue)
        : isDiscoveryCommand
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
    });
}
