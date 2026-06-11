/**
 * 数据持久化层（本地 JSON 存储）
 * 对应 confluence-cli 的 internal/apiclient/ — 但这里是本地文件而非 HTTP API
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { CLIError } from './errors.js';
import type { Note, CreateNoteReq, UpdateNoteReq, SearchHit, ListResult } from './types.js';

const NOTES_FILE = 'notes.json';

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

async function readNotes(dataDir: string): Promise<Note[]> {
  const fp = getNotesPath(dataDir);
  try {
    const raw = await fs.readFile(fp, 'utf-8');
    return JSON.parse(raw) as Note[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw new CLIError(
      'internal',
      'READ_FAIL',
      `Failed to read notes: ${(err as Error).message}`,
    );
  }
}

async function writeNotes(dataDir: string, notes: Note[]): Promise<void> {
  await ensureDir(dataDir);
  const fp = getNotesPath(dataDir);
  await fs.writeFile(fp, JSON.stringify(notes, null, 2), 'utf-8');
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
  const notes = await readNotes(dataDir);
  const now = new Date().toISOString();
  const note: Note = {
    id: generateId(),
    title: req.title,
    content: req.content,
    tags: req.tags ?? [],
    createdAt: now,
    updatedAt: now,
  };
  notes.push(note);
  await writeNotes(dataDir, notes);
  return note;
}

export async function updateNote(dataDir: string, req: UpdateNoteReq): Promise<Note> {
  const notes = await readNotes(dataDir);
  const idx = notes.findIndex((n) => n.id === req.id);
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
  const existing = notes[idx];
  const updated: Note = {
    ...existing,
    title: req.title ?? existing.title,
    content: req.content ?? existing.content,
    tags: req.tags ?? existing.tags,
    updatedAt: new Date().toISOString(),
  };
  notes[idx] = updated;
  await writeNotes(dataDir, notes);
  return updated;
}

export async function deleteNote(dataDir: string, id: string): Promise<void> {
  const notes = await readNotes(dataDir);
  const idx = notes.findIndex((n) => n.id === id);
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
  notes.splice(idx, 1);
  await writeNotes(dataDir, notes);
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

export async function exportNotes(dataDir: string, filePath: string): Promise<ExportResult> {
  const notes = await readNotes(dataDir);
  const payload = {
    exportedFrom: 'notes-cli',
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    count: notes.length,
    notes,
  };
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8');
  return {
    filePath,
    count: notes.length,
    exportedAt: payload.exportedAt,
  };
}

function escapeCsvCell(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function exportNotesCSV(dataDir: string, filePath: string): Promise<ExportResult> {
  const notes = await readNotes(dataDir);
  const headers = ['id', 'title', 'content', 'tags', 'createdAt', 'updatedAt'];
  const lines = notes.map((n) =>
    [
      n.id,
      escapeCsvCell(n.title),
      escapeCsvCell(n.content),
      escapeCsvCell(n.tags.join(';')),
      n.createdAt,
      n.updatedAt,
    ].join(','),
  );
  const csv = [headers.join(','), ...lines].join('\n');
  await fs.writeFile(filePath, csv, 'utf-8');
  return {
    filePath,
    count: notes.length,
    exportedAt: new Date().toISOString(),
  };
}
