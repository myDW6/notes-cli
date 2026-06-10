#!/usr/bin/env node
/**
 * 程序入口
 * 对应 confluence-cli 的 cmd/confluence-cli/main.go
 */
import { execute } from './commands.js';

const code = await execute(process.argv);
process.exit(code);
