/**
 * 数据持久化层（本地 JSON 存储）
 * 对应 confluence-cli 的 internal/apiclient/ — 但这里是本地文件而非 HTTP API
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CLIError } from './errors.js';
import { requestFingerprint } from './idempotency.js';
import type { Note, CreateNoteReq, UpdateNoteReq, SearchHit, ListResult } from './types.js';

const NOTES_FILE = 'notes.json';
const STORAGE_SCHEMA_VERSION = 2;

interface CreateIdempotencyRecord {
  command: 'create';
  fingerprint: string;
  result: Note;
}

interface StorageState {
  schemaVersion: typeof STORAGE_SCHEMA_VERSION;
  notes: Note[];
  idempotency: Record<string, CreateIdempotencyRecord>;
}

export interface IdempotentCreateResult {
  note: Note;
  idempotency: {
    key: string;
    fingerprint: string;
    replayed: boolean;
  };
}

function getNotesPath(dataDir: string): string {
  return path.join(dataDir, NOTES_FILE);
}

async function ensureDir(dir: string): Promise<void> {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // ignore
  }
}

function emptyState(): StorageState {
  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    notes: [],
    idempotency: {},
  };
}

async function readState(dataDir: string): Promise<StorageState> {
  const fp = getNotesPath(dataDir);
  try {
    const raw = await fs.readFile(fp, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return {
        ...emptyState(),
        notes: parsed as Note[],
      };
    }
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      Array.isArray((parsed as StorageState).notes)
    ) {
      const state = parsed as Partial<StorageState>;
      return {
        schemaVersion: STORAGE_SCHEMA_VERSION,
        notes: state.notes ?? [],
        idempotency: state.idempotency ?? {},
      };
    }
    throw new Error('Unsupported notes storage format');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return emptyState();
    }
    throw new CLIError(
      'internal',
      'READ_FAIL',
      `Failed to read notes: ${(err as Error).message}`,
    );
  }
}

async function writeState(dataDir: string, state: StorageState): Promise<void> {
  await ensureDir(dataDir);
  const fp = getNotesPath(dataDir);
  const tempPath = `${fp}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tempPath, JSON.stringify(state, null, 2), 'utf-8');
    await fs.rename(tempPath, fp);
  } catch (err) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw new CLIError(
      'internal',
      'WRITE_FAIL',
      `Failed to write notes: ${(err as Error).message}`,
    );
  }
}

async function readNotes(dataDir: string): Promise<Note[]> {
  return (await readState(dataDir)).notes;
}

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// ---------- CRUD 操作 ----------

export async function listNotes(dataDir: string, opts: { limit: number; cursor?: string }): Promise<ListResult<Note>> {
  const all = await readNotes(dataDir);
  const start = opts.cursor ? parseInt(opts.cursor, 10) : 0;
  const items = all.slice(start, start + opts.limit);
  const nextStart = start + opts.limit;
  return {
    items,
    hasMore: nextStart < all.length,
    next: nextStart < all.length ? String(nextStart) : undefined,
  };
}

export async function getNote(dataDir: string, id: string): Promise<Note> {
  const notes = await readNotes(dataDir);
  const note = notes.find((n) => n.id === id);
  if (!note) {
    throw new CLIError(
      'not_found',
      'NOTE_NOT_FOUND',
      `Note "${id}" not found`,
      'Check the ID or list all notes.',
      ['notes list'],
      { id },
    );
  }
  return note;
}

export async function createNote(dataDir: string, req: CreateNoteReq): Promise<Note> {
  const state = await readState(dataDir);
  const now = new Date().toISOString();
  const note: Note = {
    id: generateId(),
    title: req.title,
    content: req.content,
    tags: req.tags ?? [],
    createdAt: now,
    updatedAt: now,
  };
  state.notes.push(note);
  await writeState(dataDir, state);
  return note;
}

export async function createNoteIdempotent(
  dataDir: string,
  req: CreateNoteReq,
  key: string,
): Promise<IdempotentCreateResult> {
  const state = await readState(dataDir);
  const scopedKey = `create:${key}`;
  const fingerprint = requestFingerprint(req);
  const existing = state.idempotency[scopedKey];

  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      throw new CLIError(
        'conflict',
        'IDEMPOTENCY_KEY_REUSED',
        `Idempotency key "${key}" was already used with different input`,
        'Use the original input to retry, or choose a new idempotency key.',
        [],
        { key, command: 'create' },
        false,
      );
    }
    return {
      note: existing.result,
      idempotency: {
        key,
        fingerprint,
        replayed: true,
      },
    };
  }

  const now = new Date().toISOString();
  const note: Note = {
    id: generateId(),
    title: req.title,
    content: req.content,
    tags: req.tags ?? [],
    createdAt: now,
    updatedAt: now,
  };
  state.notes.push(note);
  state.idempotency[scopedKey] = {
    command: 'create',
    fingerprint,
    result: note,
  };
  await writeState(dataDir, state);

  return {
    note,
    idempotency: {
      key,
      fingerprint,
      replayed: false,
    },
  };
}

export async function updateNote(dataDir: string, req: UpdateNoteReq): Promise<Note> {
  const state = await readState(dataDir);
  const idx = state.notes.findIndex((n) => n.id === req.id);
  if (idx === -1) {
    throw new CLIError(
      'not_found',
      'NOTE_NOT_FOUND',
      `Note "${req.id}" not found`,
      '',
      ['notes list'],
      { id: req.id },
    );
  }
  const existing = state.notes[idx];
  const updated: Note = {
    ...existing,
    title: req.title ?? existing.title,
    content: req.content ?? existing.content,
    tags: req.tags ?? existing.tags,
    updatedAt: new Date().toISOString(),
  };
  state.notes[idx] = updated;
  await writeState(dataDir, state);
  return updated;
}

export async function deleteNote(dataDir: string, id: string): Promise<void> {
  const state = await readState(dataDir);
  const idx = state.notes.findIndex((n) => n.id === id);
  if (idx === -1) {
    throw new CLIError(
      'not_found',
      'NOTE_NOT_FOUND',
      `Note "${id}" not found`,
      '',
      ['notes list'],
      { id },
    );
  }
  state.notes.splice(idx, 1);
  await writeState(dataDir, state);
}

export async function searchNotes(dataDir: string, keyword: string): Promise<SearchHit[]> {
  const notes = await readNotes(dataDir);
  const lower = keyword.toLowerCase();
  return notes
    .filter(
      (n) =>
        n.title.toLowerCase().includes(lower) ||
        n.content.toLowerCase().includes(lower) ||
        n.tags.some((t) => t.toLowerCase().includes(lower)),
    )
    .map((n) => ({
      id: n.id,
      title: n.title,
      excerpt: n.content.slice(0, 120).replace(/\n/g, ' ') + (n.content.length > 120 ? '...' : ''),
    }));
}

/**
 * --dry-run 预览：描述将要执行的操作
 * 对应 confluence-cli 的 DescribeWrite
 */
export function describeCreate(req: CreateNoteReq): Record<string, unknown> {
  return {
    action: 'create',
    title: req.title,
    contentLength: req.content.length,
    tags: req.tags ?? [],
  };
}

export function describeDelete(id: string): Record<string, unknown> {
  return {
    action: 'delete',
    id,
  };
}

export interface ExportResult {
  filePath: string;
  count: number;
  exportedAt: string;
}

export interface ExportContent {
  content: string;
  count: number;
  exportedAt: string;
}

export async function renderNotesExport(
  dataDir: string,
  format: 'json' | 'csv',
): Promise<ExportContent> {
  const notes = await readNotes(dataDir);
  const exportedAt = new Date().toISOString();
  if (format === 'json') {
    return {
      content: `${JSON.stringify({
        exportedFrom: 'notes-cli',
        version: '1.0.0',
        exportedAt,
        count: notes.length,
        notes,
      }, null, 2)}\n`,
      count: notes.length,
      exportedAt,
    };
  }

  const headers = ['id', 'title', 'content', 'tags', 'createdAt', 'updatedAt'];
  const lines = notes.map((note) =>
    [
      note.id,
      escapeCsvCell(note.title),
      escapeCsvCell(note.content),
      escapeCsvCell(note.tags.join(';')),
      note.createdAt,
      note.updatedAt,
    ].join(','),
  );
  return {
    content: `${[headers.join(','), ...lines].join('\n')}\n`,
    count: notes.length,
    exportedAt,
  };
}

export async function exportNotes(dataDir: string, filePath: string): Promise<ExportResult> {
  const rendered = await renderNotesExport(dataDir, 'json');
  await fs.writeFile(filePath, rendered.content, 'utf-8');
  return {
    filePath,
    count: rendered.count,
    exportedAt: rendered.exportedAt,
  };
}

function escapeCsvCell(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function exportNotesCSV(dataDir: string, filePath: string): Promise<ExportResult> {
  const rendered = await renderNotesExport(dataDir, 'csv');
  await fs.writeFile(filePath, rendered.content, 'utf-8');
  return {
    filePath,
    count: rendered.count,
    exportedAt: rendered.exportedAt,
  };
}
