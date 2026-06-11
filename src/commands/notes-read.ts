import { CLIError } from '../cli/errors.js';
import { parseLimit } from '../cli/parsers.js';
import { getNote, listNotes, searchNotes } from '../notes/storage.js';
import type { Command } from 'commander';
import type { CommandContext } from '../cli/runtime.js';

export function registerReadCommands(
  program: Command,
  context: CommandContext,
): void {
  program
    .command('list')
    .description('List notes')
    .option('-l, --limit <n>', 'page size')
    .option('--cursor <cursor>', 'opaque pagination cursor')
    .option('--all', 'fetch all pages', false)
    .action(async (options) => {
      const config = await context.config();
      const limit = parseLimit(options.limit ?? String(config.pageSize));
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
        const allItems = await context.run(async () => {
          const items: Awaited<ReturnType<typeof listNotes>>['items'] = [];
          let next: string | undefined;
          do {
            const page = await listNotes(config.dataDir, {
              limit,
              cursor: next,
            });
            items.push(...page.items);
            next = page.next;
          } while (next);
          return items;
        }, { idempotent: true });
        context.emitList(allItems, { hasMore: false });
        return;
      }

      const page = await context.run(
        () => listNotes(config.dataDir, { limit, cursor }),
        { idempotent: true },
      );
      context.emitList(page.items, {
        hasMore: page.hasMore,
        next: page.next,
      });
    });

  program
    .command('get <id>')
    .description('Get a note by ID')
    .action(async (id: string) => {
      const config = await context.config();
      context.emit(await context.run(
        () => getNote(config.dataDir, id),
        { idempotent: true },
      ));
    });

  program
    .command('search <keyword>')
    .description('Search notes by keyword')
    .action(async (keyword: string) => {
      const config = await context.config();
      context.emit({
        items: await context.run(
          () => searchNotes(config.dataDir, keyword),
          { idempotent: true },
        ),
      });
    });
}
