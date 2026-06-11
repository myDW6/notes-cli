import { runDoctor } from '../diagnostics/doctor.js';
import { configLoadOptions } from '../cli/runtime.js';
import type { Command } from 'commander';
import type { CommandContext } from '../cli/runtime.js';
import type { DoctorReport } from '../diagnostics/doctor.js';

function emitHumanReport(report: DoctorReport): void {
  for (const item of report.checks) {
    console.log(`[${item.status.toUpperCase()}] ${item.id}: ${item.message}`);
    if (item.hint) console.log(`  Hint: ${item.hint}`);
    for (const step of item.nextSteps ?? []) {
      console.log(`  Next: ${step}`);
    }
  }
  console.log(
    `Status: ${report.status} ` +
    `(pass=${report.summary.pass}, warn=${report.summary.warn}, ` +
    `fail=${report.summary.fail}, skip=${report.summary.skip})`,
  );
}

export function registerDoctorCommand(
  program: Command,
  context: CommandContext,
): void {
  program
    .command('doctor')
    .description('Diagnose CLI configuration, storage, and runtime health')
    .action(async () => {
      const report = await runDoctor(configLoadOptions(context.state));
      if (context.humanOutput) {
        emitHumanReport(report);
      } else {
        context.emit(report);
      }
      if (report.status === 'fail') {
        context.state.exitCode = 1;
      }
    });
}
