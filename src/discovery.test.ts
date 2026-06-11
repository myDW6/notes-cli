import { describe, expect, it } from 'vitest';
import {
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
