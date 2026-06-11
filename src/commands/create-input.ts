import fs from 'node:fs/promises';
import { input } from '@inquirer/prompts';
import { validateCreateInput } from '../protocol/discovery.js';
import { CLIError, isCLIError } from '../cli/errors.js';
import { parseTags } from '../cli/parsers.js';
import type { CreateNoteReq } from '../notes/types.js';

interface CreateOptions {
  title?: string;
  content?: string;
  tags?: string;
  input?: string;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

async function readCreateInput(inputPath: string): Promise<CreateNoteReq> {
  let raw: string;
  try {
    raw = inputPath === '-'
      ? await readStdin()
      : await fs.readFile(inputPath, 'utf-8');
  } catch (err) {
    throw new CLIError(
      'usage',
      'INPUT_READ_ERROR',
      `Failed to read create input: ${(err as Error).message}`,
      '',
      [],
      { path: inputPath },
    );
  }

  try {
    return validateCreateInput(JSON.parse(raw) as unknown);
  } catch (err) {
    if (isCLIError(err)) throw err;
    throw new CLIError(
      'usage',
      'INVALID_INPUT_JSON',
      'Create input is not valid JSON',
      '',
      [],
      { path: inputPath },
    );
  }
}

export async function resolveCreateRequest(
  options: CreateOptions,
  interactive: boolean,
): Promise<CreateNoteReq> {
  const hasFieldInput =
    options.title !== undefined ||
    options.content !== undefined ||
    options.tags !== undefined;

  if (options.input && hasFieldInput) {
    throw new CLIError(
      'usage',
      'CONFLICTING_INPUT',
      '--input cannot be combined with --title, --content or --tags',
      '',
      [],
      { inputSources: ['input', 'field-options'] },
    );
  }

  if (options.input) {
    return readCreateInput(options.input);
  }

  let title = options.title;
  let content = options.content;
  let tagsRaw = options.tags;

  if (title === undefined && interactive) {
    title = await input({ message: 'Note title:' });
  }
  if (title === undefined || title.trim() === '') {
    throw new CLIError(
      'usage',
      'MISSING_REQUIRED_INPUT',
      'title is required',
      '',
      [],
      { field: 'title' },
    );
  }
  if (!hasFieldInput && interactive) {
    content = await input({ message: 'Content:' });
    tagsRaw = await input({ message: 'Tags (optional):' });
  }

  return {
    title: title.trim(),
    content: content ?? '',
    tags: parseTags(tagsRaw),
  };
}
