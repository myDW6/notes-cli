import {
  BATCH_ITEM_SCHEMA,
  CLI_CAPABILITIES,
  CREATE_NOTE_INPUT_SCHEMA,
} from '../protocol/discovery.js';
import type { Command } from 'commander';
import type { CommandContext } from '../cli/runtime.js';

export function registerDiscoveryCommands(
  program: Command,
  context: CommandContext,
): void {
  program
    .command('capabilities')
    .description('Describe CLI capabilities for automated clients')
    .action(() => {
      context.emit(CLI_CAPABILITIES);
    });

  const schema = program
    .command('schema')
    .description('Describe structured input schemas');

  schema
    .command('create')
    .description('Show the JSON Schema accepted by notes create --input')
    .action(() => {
      context.emit(CREATE_NOTE_INPUT_SCHEMA);
    });

  schema
    .command('batch')
    .description('Show the JSON Schema accepted by notes batch --input-jsonl')
    .action(() => {
      context.emit(BATCH_ITEM_SCHEMA);
    });
}
