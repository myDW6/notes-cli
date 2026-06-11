#!/usr/bin/env node
/**
 * 程序入口
 * 对应 confluence-cli 的 cmd/confluence-cli/main.go
 */
import { execute } from './commands.js';
import { CancellationContext } from './cli/cancellation.js';
import { installBrokenPipeHandler, installSignalHandlers } from './cli/process.js';

installBrokenPipeHandler();
const cancellation = new CancellationContext();
const removeSignalHandlers = installSignalHandlers(cancellation);
try {
  process.exitCode = await execute(process.argv, cancellation);
} finally {
  cancellation.dispose();
  removeSignalHandlers();
}
