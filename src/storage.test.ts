import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  listNotes,
  getNote,
  createNote,
  updateNote,
  deleteNote,
  searchNotes,
  exportNotes,
} from './storage.js';
import { CLIError } from './errors.js';

async function mkdtemp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'notes-test-'));
}

describe('storage', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp();
  });

  it('creates and retrieves a note', async () => {
    const created = await createNote(dataDir, { title: 'Hello', content: 'World' });
    expect(created.title).toBe('Hello');
    expect(created.content).toBe('World');
    expect(created.id).toBeDefined();

    const fetched = await getNote(dataDir, created.id);
    expect(fetched.title).toBe('Hello');
  });

  it('lists notes with pagination', async () => {
    await createNote(dataDir, { title: 'A', content: 'a' });
    await createNote(dataDir, { title: 'B', content: 'b' });
    await createNote(dataDir, { title: 'C', content: 'c' });

    const page1 = await listNotes(dataDir, { limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.hasMore).toBe(true);

    const page2 = await listNotes(dataDir, { limit: 2, cursor: page1.next });
    expect(page2.items).toHaveLength(1);
    expect(page2.hasMore).toBe(false);
  });

  it('updates a note', async () => {
    const created = await createNote(dataDir, { title: 'Old', content: 'Old body' });
    const updated = await updateNote(dataDir, { id: created.id, title: 'New' });
    expect(updated.title).toBe('New');
    expect(updated.content).toBe('Old body'); // unchanged
  });

  it('deletes a note', async () => {
    const created = await createNote(dataDir, { title: 'ToDelete', content: 'x' });
    await deleteNote(dataDir, created.id);
    await expect(getNote(dataDir, created.id)).rejects.toBeInstanceOf(CLIError);
  });

  it('searches notes', async () => {
    await createNote(dataDir, { title: 'Apple', content: 'Red fruit', tags: ['fruit'] });
    await createNote(dataDir, { title: 'Carrot', content: 'Orange vegetable', tags: ['veg'] });

    const hits = await searchNotes(dataDir, 'fruit');
    expect(hits).toHaveLength(1);
    expect(hits[0].title).toBe('Apple');
  });

  it('throws not_found for missing note', async () => {
    await expect(getNote(dataDir, 'nonexistent')).rejects.toMatchObject({
      category: 'not_found',
      code: 'NOTE_NOT_FOUND',
    });
  });

  it('exports notes to a JSON file', async () => {
    await createNote(dataDir, { title: 'A', content: 'a' });
    await createNote(dataDir, { title: 'B', content: 'b' });

    const outPath = path.join(dataDir, 'export.json');
    const result = await exportNotes(dataDir, outPath);
    expect(result.count).toBe(2);
    expect(result.filePath).toBe(outPath);

    const raw = await fs.readFile(outPath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.count).toBe(2);
    expect(parsed.notes).toHaveLength(2);
    expect(parsed.exportedFrom).toBe('notes-cli');
  });
});
