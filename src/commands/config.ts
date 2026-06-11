import { initConfig } from '../config/resolver.js';
import type { Command } from 'commander';
import type { CommandContext } from '../cli/runtime.js';

export function registerConfigCommands(
  program: Command,
  context: CommandContext,
): void {
  const configCommand = program
    .command('config')
    .description('Manage and inspect CLI configuration');

  configCommand
    .command('init')
    .description('Initialize configuration')
    .action(async () => {
      const state = context.state;
      const result = await initConfig(
        state.gflags.config,
        state.mode?.interactive === true,
      );
      context.emit(result);
    });

  configCommand
    .command('effective')
    .description('Show resolved configuration values and their sources')
    .action(async () => {
      const config = await context.config();
      context.emit({
        configFile: config.configFile,
        values: config.effective,
      });
    });
}
