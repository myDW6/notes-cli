import { select } from '@inquirer/prompts';
import { CLIError } from '../cli/errors.js';
import {
  exportNotes,
  exportNotesCSV,
  listNotes,
  renderNotesExport,
} from '../notes/storage.js';
import type { Command } from 'commander';
import type { CommandContext } from '../cli/runtime.js';

type ExportFormat = 'json' | 'csv';

async function resolveExportFormat(
  raw: string | undefined,
  interactive: boolean,
): Promise<ExportFormat> {
  let format = raw;
  if (!format && interactive) {
    format = await select({
      message: 'Export format:',
      choices: [
        { name: 'JSON', value: 'json', description: 'Structured JSON with metadata' },
        { name: 'CSV', value: 'csv', description: 'Comma-separated values' },
      ],
    });
  }
  format = format ?? 'json';
  if (format !== 'json' && format !== 'csv') {
    throw new CLIError(
      'usage',
      'INVALID_ARGUMENT',
      '--export-format must be json or csv',
      '',
      [],
      { argument: 'export-format', value: format, expected: ['json', 'csv'] },
    );
  }
  return format;
}

function assertRawOutputCompatible(context: CommandContext): void {
  const flags = context.state.gflags;
  const conflictingOptions = [
    flags.output || flags.legacyFormat ? 'output' : undefined,
    flags.fields ? 'fields' : undefined,
    flags.quiet ? 'quiet' : undefined,
  ].filter((value): value is string => value !== undefined);

  if (conflictingOptions.length > 0) {
    throw new CLIError(
      'usage',
      'RAW_OUTPUT_CONFLICT',
      'export to stdout cannot be combined with protocol output options',
      '',
      [],
      {
        options: conflictingOptions,
        hint: 'Use --export-format to choose the raw stdout format.',
      },
    );
  }
}

export function registerExportCommand(
  program: Command,
  context: CommandContext,
): void {
  program
    .command('export [path]')
    .description('Export all notes to a file')
    .option('--export-format <format>', 'export file format: json or csv')
    .option('--dry-run', 'preview the export without writing', false)
    .action(async (pathArg: string | undefined, options) => {
      const config = await context.config();
      const format = await resolveExportFormat(
        options.exportFormat as string | undefined,
        context.state.mode?.interactive === true,
      );
      const filePath = pathArg ?? `notes-export.${format}`;

      if (options.dryRun) {
        const notes = await listNotes(config.dataDir, { limit: 1000 });
        context.emit({
          operation: 'export',
          executed: false,
          willWrite: true,
          filePath,
          format,
          count: notes.items.length,
        });
        return;
      }

      if (filePath === '-') {
        assertRawOutputCompatible(context);
        const rendered = await renderNotesExport(config.dataDir, format);
        process.stdout.write(rendered.content);
        return;
      }

      const result = format === 'csv'
        ? await exportNotesCSV(config.dataDir, filePath)
        : await exportNotes(config.dataDir, filePath);

      if (context.humanOutput) {
        console.log(`Exported ${result.count} notes to ${filePath}`);
      }
      context.emit(result);
    });
}
