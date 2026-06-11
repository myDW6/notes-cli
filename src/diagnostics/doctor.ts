import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { loadConfig } from '../config/resolver.js';
import { isCLIError } from '../cli/errors.js';
import { inspectStorage } from '../notes/storage.js';
import type { LoadOptions, ResolvedConfig } from '../config/resolver.js';

export type DoctorStatus = 'pass' | 'warn' | 'fail' | 'skip';

export interface DoctorCheck {
  id: string;
  status: DoctorStatus;
  message: string;
  hint?: string;
  nextSteps?: string[];
  details?: Record<string, unknown>;
}

export interface DoctorReport {
  status: 'pass' | 'warn' | 'fail';
  checks: DoctorCheck[];
  summary: {
    pass: number;
    warn: number;
    fail: number;
    skip: number;
  };
}

function check(
  id: string,
  status: DoctorStatus,
  message: string,
  options: Omit<DoctorCheck, 'id' | 'status' | 'message'> = {},
): DoctorCheck {
  return { id, status, message, ...options };
}

function runtimeCheck(nodeVersion: string): DoctorCheck {
  const major = Number(nodeVersion.split('.')[0]);
  if (Number.isInteger(major) && major >= 20) {
    return check('runtime.node', 'pass', `Node.js ${nodeVersion} is supported`, {
      details: { version: nodeVersion, minimumMajor: 20 },
    });
  }
  return check('runtime.node', 'fail', `Node.js ${nodeVersion} is not supported`, {
    hint: 'Install Node.js 20 or newer.',
    details: { version: nodeVersion, minimumMajor: 20 },
  });
}

function skipped(id: string, dependency: string): DoctorCheck {
  return check(id, 'skip', `Skipped because ${dependency} failed`, {
    details: { dependency },
  });
}

async function nearestExistingParent(targetPath: string): Promise<string> {
  let current = path.resolve(targetPath);
  while (true) {
    try {
      await fs.stat(current);
      return current;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      const parent = path.dirname(current);
      if (parent === current) return current;
      current = parent;
    }
  }
}

async function inspectDataDirectory(config: ResolvedConfig): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  let directoryExists = false;

  try {
    const stat = await fs.stat(config.dataDir);
    if (!stat.isDirectory()) {
      checks.push(check('dataDir.type', 'fail', 'Data path is not a directory', {
        hint: 'Choose a directory with --data-dir or update the configuration.',
        nextSteps: ['notes config effective --output json'],
        details: { path: config.dataDir },
      }));
      checks.push(skipped('dataDir.readable', 'dataDir.type'));
      checks.push(skipped('dataDir.writable', 'dataDir.type'));
      checks.push(skipped('storage.format', 'dataDir.type'));
      return checks;
    }
    directoryExists = true;
    checks.push(check('dataDir.type', 'pass', 'Data directory exists', {
      details: { path: config.dataDir },
    }));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      checks.push(check(
        'dataDir.type',
        'warn',
        'Data directory does not exist yet',
        {
          hint: 'It will be created by the first write operation.',
          details: { path: config.dataDir },
        },
      ));
    } else {
      checks.push(check('dataDir.type', 'fail', 'Data directory cannot be inspected', {
        details: { path: config.dataDir, cause: (err as Error).message },
      }));
      checks.push(skipped('dataDir.readable', 'dataDir.type'));
      checks.push(skipped('dataDir.writable', 'dataDir.type'));
      checks.push(skipped('storage.format', 'dataDir.type'));
      return checks;
    }
  }

  if (directoryExists) {
    try {
      await fs.access(config.dataDir, constants.R_OK);
      checks.push(check('dataDir.readable', 'pass', 'Data directory is readable', {
        details: { path: config.dataDir },
      }));
    } catch (err) {
      checks.push(check('dataDir.readable', 'fail', 'Data directory is not readable', {
        hint: 'Check directory ownership and read permissions.',
        details: { path: config.dataDir, cause: (err as Error).message },
      }));
    }

    try {
      await fs.access(config.dataDir, constants.W_OK);
      checks.push(check('dataDir.writable', 'pass', 'Data directory is writable', {
        details: { path: config.dataDir },
      }));
    } catch (err) {
      checks.push(check('dataDir.writable', 'fail', 'Data directory is not writable', {
        hint: 'Check directory ownership and write permissions.',
        nextSteps: ['notes config effective --output json'],
        details: { path: config.dataDir, cause: (err as Error).message },
      }));
    }
  } else {
    checks.push(skipped('dataDir.readable', 'dataDir.type'));
    try {
      const parent = await nearestExistingParent(config.dataDir);
      await fs.access(parent, constants.W_OK);
      checks.push(check(
        'dataDir.writable',
        'pass',
        'Data directory can be created in a writable parent',
        { details: { path: config.dataDir, parent } },
      ));
    } catch (err) {
      checks.push(check('dataDir.writable', 'fail', 'Data directory cannot be created', {
        hint: 'Choose a path under a writable parent directory.',
        nextSteps: ['notes config effective --output json'],
        details: { path: config.dataDir, cause: (err as Error).message },
      }));
    }
  }

  if (!directoryExists) {
    checks.push(skipped('storage.format', 'dataDir.type'));
    return checks;
  }

  try {
    const storage = await inspectStorage(config.dataDir);
    if (storage.format === 'missing') {
      checks.push(check('storage.format', 'pass', 'Notes storage is not initialized yet', {
        details: { ...storage },
      }));
    } else if (storage.format === 'legacy-array') {
      checks.push(check('storage.format', 'warn', 'Legacy notes storage format detected', {
        hint: 'The next write will migrate the storage to schema version 2.',
        details: { ...storage },
      }));
    } else if (storage.format === 'v2') {
      checks.push(check('storage.format', 'pass', 'Notes storage format is supported', {
        details: { ...storage },
      }));
    } else {
      checks.push(check('storage.format', 'fail', 'Notes storage format is unsupported', {
        hint: 'Back up the file before repairing or recreating it.',
        details: { ...storage },
      }));
    }
  } catch (err) {
    checks.push(check('storage.format', 'fail', 'Notes storage cannot be inspected', {
      hint: isCLIError(err) ? err.hint : undefined,
      nextSteps: isCLIError(err) ? err.nextSteps : undefined,
      details: isCLIError(err)
        ? { code: err.code, ...err.details }
        : { cause: (err as Error).message },
    }));
  }

  return checks;
}

function summarize(checks: DoctorCheck[]): DoctorReport {
  const summary = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const item of checks) summary[item.status] += 1;
  return {
    status: summary.fail > 0 ? 'fail' : summary.warn > 0 ? 'warn' : 'pass',
    checks,
    summary,
  };
}

export async function runDoctor(
  loadOptions: LoadOptions,
  nodeVersion = process.versions.node,
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [runtimeCheck(nodeVersion)];
  let config: ResolvedConfig;

  try {
    config = await loadConfig(loadOptions);
    checks.push(check('config.resolve', 'pass', 'Configuration resolved successfully', {
      details: {
        configFile: config.configFile,
        dataDir: config.dataDir,
      },
    }));
  } catch (err) {
    checks.push(check('config.resolve', 'fail', 'Configuration could not be resolved', {
      hint: isCLIError(err) ? err.hint : undefined,
      nextSteps: isCLIError(err) ? err.nextSteps : undefined,
      details: isCLIError(err)
        ? { code: err.code, ...err.details }
        : { cause: (err as Error).message },
    }));
    checks.push(skipped('dataDir.type', 'config.resolve'));
    checks.push(skipped('dataDir.readable', 'config.resolve'));
    checks.push(skipped('dataDir.writable', 'config.resolve'));
    checks.push(skipped('storage.format', 'config.resolve'));
    return summarize(checks);
  }

  checks.push(...await inspectDataDirectory(config));
  return summarize(checks);
}
