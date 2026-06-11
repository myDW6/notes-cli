import { processJSONLBatch } from '../batch/processor.js';
import {
  BATCH_PARTIAL_FAILURE_EXIT_CODE,
  CLIError,
  exitCode,
} from '../cli/errors.js';
import { emitBatchResult } from '../cli/output.js';
import type { Command } from 'commander';
import type { CommandContext } from '../cli/runtime.js';

export function registerBatchCommand(
  program: Command,
  context: CommandContext,
): void {
  program
    .command('batch')
    .description('Execute create and delete operations from JSONL input')
    .requiredOption('--input-jsonl <path|->', 'read JSONL operations; use "-" for stdin')
    .option('--fail-fast', 'stop after the first failed item', false)
    .action(async (options) => {
      const state = context.state;
      if (state.gflags.output !== 'jsonl') {
        throw new CLIError(
          'usage',
          'OUTPUT_FORMAT_REQUIRED',
          'batch requires explicit --output jsonl',
          '',
          [],
          { requiredOutput: 'jsonl' },
        );
      }

      const config = await context.config();
      const summary = await processJSONLBatch({
        dataDir: config.dataDir,
        inputPath: String(options.inputJsonl),
        failFast: options.failFast === true,
        onResult: (result) => emitBatchResult(result, { requestId: state.requestId }),
      });

      if (summary.failed > 0) {
        state.exitCode = options.failFast && summary.firstFailureCategory
          ? exitCode(summary.firstFailureCategory)
          : BATCH_PARTIAL_FAILURE_EXIT_CODE;
      }
    });
}
