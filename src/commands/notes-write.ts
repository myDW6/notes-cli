import chalk from 'chalk';
import { confirm, input, select } from '@inquirer/prompts';
import { CLIError } from '../cli/errors.js';
import { normalizeIdempotencyKey, requestFingerprint } from '../notes/idempotency.js';
import { parseTags } from '../cli/parsers.js';
import {
  createNote,
  createNoteIdempotent,
  deleteNote,
  describeCreate,
  describeDelete,
  getNote,
  listNotes,
  updateNote,
} from '../notes/storage.js';
import { resolveCreateRequest } from './create-input.js';
import type { Command } from 'commander';
import type { CommandContext } from '../cli/runtime.js';

function registerCreateCommand(program: Command, context: CommandContext): void {
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
      const config = await context.config();
      const request = await resolveCreateRequest(
        options,
        context.state.mode?.interactive === true,
      );
      const idempotencyKey = options.idempotencyKey
        ? normalizeIdempotencyKey(String(options.idempotencyKey))
        : undefined;

      if (options.dryRun) {
        context.emit({
          operation: 'create',
          executed: false,
          willWrite: true,
          normalizedInput: request,
          plan: describeCreate(request),
          ...(idempotencyKey
            ? {
                idempotency: {
                  key: idempotencyKey,
                  fingerprint: requestFingerprint(request),
                  stored: false,
                },
              }
            : {}),
        });
        return;
      }

      const result = idempotencyKey
        ? await createNoteIdempotent(config.dataDir, request, idempotencyKey)
        : undefined;
      const note = result?.note ?? await createNote(config.dataDir, request);
      if (context.humanOutput) {
        console.log(
          chalk.green(result?.idempotency.replayed ? 'Replayed note' : 'Created note'),
          chalk.bold(note.id),
        );
      }
      context.emit(
        result
          ? { ...note, idempotency: result.idempotency }
          : note,
      );
    });
}

function registerUpdateCommand(program: Command, context: CommandContext): void {
  program
    .command('update <id>')
    .description('Update an existing note')
    .option('-t, --title <title>', 'new title')
    .option('--content <content>', 'new content')
    .option('--tags <tags>', 'comma-separated tags')
    .option('--dry-run', 'preview the request without updating', false)
    .action(async (id: string, options) => {
      const config = await context.config();
      const request = {
        id,
        title: options.title as string | undefined,
        content: options.content as string | undefined,
        tags: options.tags ? parseTags(String(options.tags)) : undefined,
      };

      if (options.dryRun) {
        context.emit({
          operation: 'update',
          executed: false,
          willWrite: true,
          normalizedInput: request,
        });
        return;
      }

      context.emit(await updateNote(config.dataDir, request));
    });
}

function registerDeleteCommand(program: Command, context: CommandContext): void {
  program
    .command('delete <id>')
    .description('Delete a note')
    .option('--yes', 'confirm deletion without prompting', false)
    .option('--dry-run', 'preview the request without deleting', false)
    .action(async (id: string, options) => {
      const config = await context.config();

      if (options.dryRun) {
        context.emit({
          operation: 'delete',
          executed: false,
          willWrite: true,
          plan: describeDelete(id),
        });
        return;
      }

      if (!options.yes) {
        if (!context.state.mode?.interactive) {
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
          context.emit({ deleted: false, id });
          return;
        }
      }

      await deleteNote(config.dataDir, id);
      context.emit({ deleted: true, id });
    });
}

function registerInteractiveEditCommand(
  program: Command,
  context: CommandContext,
): void {
  program
    .command('interactive-edit')
    .description('Interactively select and edit a note')
    .action(async () => {
      if (!context.state.mode?.interactive) {
        throw new CLIError(
          'usage',
          'TTY_REQUIRED',
          'interactive-edit requires interactive mode',
          'This command uses prompts that need a real terminal.',
          ['notes update <id> --title "..." --content "..."'],
        );
      }

      const config = await context.config();
      const { items } = await listNotes(config.dataDir, { limit: 1000 });
      if (items.length === 0) {
        if (context.humanOutput) {
          console.log(chalk.yellow('No notes to edit.'));
        }
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
      const note = await getNote(config.dataDir, selectedId);
      const title = await input({ message: `New title (keep "${note.title}"):` });
      const content = await input({ message: 'New content (keep current):' });
      const tagsRaw = await input({
        message: `New tags (keep "${note.tags.join(', ') || 'none'}"):`,
      });

      const request: { id: string; title?: string; content?: string; tags?: string[] } = {
        id: selectedId,
      };
      if (title.trim()) request.title = title.trim();
      if (content.trim()) request.content = content.trim();
      const tags = parseTags(tagsRaw);
      if (tags.length > 0 && JSON.stringify(tags) !== JSON.stringify(note.tags)) {
        request.tags = tags;
      }

      if (Object.keys(request).length <= 1) {
        if (context.humanOutput) {
          console.log(chalk.gray('No changes made.'));
        }
        return;
      }

      const updated = await updateNote(config.dataDir, request);
      if (context.humanOutput) {
        console.log('Updated note', chalk.bold(updated.id));
      }
      context.emit(updated);
    });
}

export function registerWriteCommands(
  program: Command,
  context: CommandContext,
): void {
  registerCreateCommand(program, context);
  registerUpdateCommand(program, context);
  registerDeleteCommand(program, context);
  registerInteractiveEditCommand(program, context);
}
