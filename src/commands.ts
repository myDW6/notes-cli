import { Command, CommanderError } from 'commander';
import { configureProgram } from './cli/program.js';
import { CommandContext, createAppState } from './cli/runtime.js';
import { registerBatchCommand } from './commands/batch.js';
import { registerConfigCommands } from './commands/config.js';
import { registerDiscoveryCommands } from './commands/discovery.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerExportCommand } from './commands/export.js';
import { registerReadCommands } from './commands/notes-read.js';
import { registerWriteCommands } from './commands/notes-write.js';
import { CLIError, exitCode, isCLIError } from './cli/errors.js';
import { emitError } from './cli/output.js';
import type { AppState } from './cli/runtime.js';

function registerCommands(program: Command, context: CommandContext): void {
  registerDiscoveryCommands(program, context);
  registerDoctorCommand(program, context);
  registerBatchCommand(program, context);
  registerReadCommands(program, context);
  registerWriteCommands(program, context);
  registerExportCommand(program, context);
  registerConfigCommands(program, context);
}

export function buildCLI(state: AppState = createAppState()): Command {
  const program = new Command();
  configureProgram(program, state);
  registerCommands(program, new CommandContext(state));
  return program;
}

function normalizeError(error: unknown): CLIError {
  if (isCLIError(error)) return error;
  if (error instanceof CommanderError) {
    return new CLIError(
      'usage',
      'INVALID_COMMAND_USAGE',
      error.message,
      '',
      [],
      { commanderCode: error.code },
    );
  }
  return new CLIError('internal', 'INTERNAL', (error as Error).message);
}

export async function execute(argv: string[]): Promise<number> {
  const state = createAppState(argv);
  const program = buildCLI(state);

  try {
    await program.parseAsync(argv);
    return state.exitCode;
  } catch (error) {
    if (
      error instanceof CommanderError &&
      (error.code === 'commander.helpDisplayed' || error.code === 'commander.version')
    ) {
      return 0;
    }

    const cliError = normalizeError(error);
    emitError(cliError, {
      command: state.commandName,
      requestId: state.requestId,
      pretty: state.gflags.pretty,
    });
    return exitCode(cliError.category);
  }
}
