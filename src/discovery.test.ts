import { describe, expect, it } from 'vitest';
import {
  BATCH_ITEM_SCHEMA,
  CLI_CAPABILITIES,
  CREATE_NOTE_INPUT_SCHEMA,
  validateCreateInput,
} from './discovery.js';

describe('CLI discovery contracts', () => {
  it('uses the protocol version in the create schema ID', () => {
    expect(CREATE_NOTE_INPUT_SCHEMA.$id).toBe('notes.cli/v1/create-input');
    expect(CLI_CAPABILITIES.protocolVersions).toContain('notes.cli/v1');
    expect(CLI_CAPABILITIES.commands.create.inputSchema).toBe(
      CREATE_NOTE_INPUT_SCHEMA.$id,
    );
    expect(CLI_CAPABILITIES.commands.create).toMatchObject({
      supportsIdempotencyKey: true,
      idempotencyRequired: false,
    });
  });

  it('publishes the JSONL batch contract', () => {
    expect(BATCH_ITEM_SCHEMA.$id).toBe('notes.cli/v1/batch-item');
    expect(CLI_CAPABILITIES.commands.batch).toMatchObject({
      inputFormat: 'jsonl',
      requiredOutputFormat: 'jsonl',
      supportedOperations: ['create', 'delete'],
      supportsFailFast: true,
      atomic: false,
    });
  });

  it('normalizes defaults defined by the create schema', () => {
    expect(validateCreateInput({ title: '  A  ' })).toEqual({
      title: 'A',
      content: CREATE_NOTE_INPUT_SCHEMA.properties.content.default,
      tags: CREATE_NOTE_INPUT_SCHEMA.properties.tags.default,
    });
  });

  it('rejects fields not declared in the create schema', () => {
    expect(() => validateCreateInput({
      title: 'A',
      contents: 'typo',
    })).toThrowError(expect.objectContaining({
      code: 'UNKNOWN_INPUT_FIELD',
      details: {
        field: 'contents',
        allowedFields: ['title', 'content', 'tags'],
      },
    }));
  });
});
