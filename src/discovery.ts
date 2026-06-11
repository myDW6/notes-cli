import { CLIError } from './errors.js';
import { API_VERSION } from './output.js';
import type { CreateNoteReq } from './types.js';

export const CREATE_NOTE_INPUT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${API_VERSION}/create-input`,
  title: 'Create note input',
  type: 'object',
  additionalProperties: false,
  required: ['title'],
  properties: {
    title: {
      type: 'string',
      minLength: 1,
    },
    content: {
      type: 'string',
      default: '',
    },
    tags: {
      type: 'array',
      items: {
        type: 'string',
        minLength: 1,
      },
      default: [],
    },
  },
} as const;

export const CLI_CAPABILITIES = {
  commands: {
    capabilities: {
      readOnly: true,
      destructive: false,
      interactive: false,
      supportsDryRun: false,
      supportsStructuredInput: false,
    },
    'schema.create': {
      readOnly: true,
      destructive: false,
      interactive: false,
      supportsDryRun: false,
      supportsStructuredInput: false,
    },
    create: {
      readOnly: false,
      destructive: false,
      interactive: true,
      supportsDryRun: true,
      supportsStructuredInput: true,
      supportsIdempotencyKey: true,
      idempotencyRequired: false,
      inputSchema: CREATE_NOTE_INPUT_SCHEMA.$id,
    },
    get: {
      readOnly: true,
      destructive: false,
      interactive: false,
      supportsDryRun: false,
      supportsStructuredInput: false,
    },
    list: {
      readOnly: true,
      destructive: false,
      interactive: false,
      supportsDryRun: false,
      supportsStructuredInput: false,
    },
    update: {
      readOnly: false,
      destructive: false,
      interactive: false,
      supportsDryRun: true,
      supportsStructuredInput: false,
    },
    delete: {
      readOnly: false,
      destructive: true,
      interactive: true,
      requiresConfirmation: true,
      supportsDryRun: true,
      supportsStructuredInput: false,
    },
    search: {
      readOnly: true,
      destructive: false,
      interactive: false,
      supportsDryRun: false,
      supportsStructuredInput: false,
    },
    export: {
      readOnly: false,
      destructive: false,
      interactive: true,
      supportsDryRun: true,
      supportsStructuredInput: false,
      writesExternalFile: true,
    },
    'interactive-edit': {
      readOnly: false,
      destructive: false,
      interactive: true,
      supportsDryRun: false,
      supportsStructuredInput: false,
    },
    'config.init': {
      readOnly: false,
      destructive: false,
      interactive: true,
      supportsDryRun: false,
      supportsStructuredInput: false,
      writesConfiguration: true,
    },
  },
  outputFormats: ['table', 'json', 'jsonl'],
  protocolVersions: [API_VERSION],
} as const;

export function validateCreateInput(value: unknown): CreateNoteReq {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CLIError(
      'usage',
      'INVALID_INPUT',
      'Create input must be a JSON object',
      '',
      [],
      { expected: CREATE_NOTE_INPUT_SCHEMA.type },
    );
  }

  const record = value as Record<string, unknown>;
  const allowedFields = Object.keys(CREATE_NOTE_INPUT_SCHEMA.properties);
  const unknownField = Object.keys(record).find((field) => !allowedFields.includes(field));
  if (unknownField) {
    throw new CLIError(
      'usage',
      'UNKNOWN_INPUT_FIELD',
      `Unknown create input field "${unknownField}"`,
      '',
      [],
      { field: unknownField, allowedFields },
    );
  }

  if (typeof record.title !== 'string' || record.title.trim().length < CREATE_NOTE_INPUT_SCHEMA.properties.title.minLength) {
    throw new CLIError(
      'usage',
      'MISSING_REQUIRED_INPUT',
      'title is required',
      '',
      [],
      { field: 'title' },
    );
  }
  if (record.content !== undefined && typeof record.content !== CREATE_NOTE_INPUT_SCHEMA.properties.content.type) {
    throw new CLIError(
      'usage',
      'INVALID_INPUT',
      'content must be a string',
      '',
      [],
      { field: 'content', expected: CREATE_NOTE_INPUT_SCHEMA.properties.content.type },
    );
  }
  if (
    record.tags !== undefined &&
    (
      !Array.isArray(record.tags) ||
      record.tags.some((tag) =>
        typeof tag !== CREATE_NOTE_INPUT_SCHEMA.properties.tags.items.type ||
        tag.trim().length < CREATE_NOTE_INPUT_SCHEMA.properties.tags.items.minLength
      )
    )
  ) {
    throw new CLIError(
      'usage',
      'INVALID_INPUT',
      'tags must be an array of non-empty strings',
      '',
      [],
      { field: 'tags', expected: 'non-empty string[]' },
    );
  }

  return {
    title: record.title.trim(),
    content:
      (record.content as string | undefined) ??
      CREATE_NOTE_INPUT_SCHEMA.properties.content.default,
    tags:
      (record.tags as string[] | undefined)?.map((tag) => tag.trim()) ??
      [...CREATE_NOTE_INPUT_SCHEMA.properties.tags.default],
  };
}
