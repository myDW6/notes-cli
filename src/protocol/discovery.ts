import { CLIError } from '../cli/errors.js';
import { API_VERSION } from '../cli/output.js';
import { DEPRECATED_OPTIONS } from './deprecations.js';
import type { CreateNoteReq } from '../notes/types.js';

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

export const BATCH_ITEM_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${API_VERSION}/batch-item`,
  title: 'Batch operation item',
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['operation', 'input'],
      properties: {
        operation: { const: 'create' },
        input: {
          type: CREATE_NOTE_INPUT_SCHEMA.type,
          additionalProperties: CREATE_NOTE_INPUT_SCHEMA.additionalProperties,
          required: CREATE_NOTE_INPUT_SCHEMA.required,
          properties: CREATE_NOTE_INPUT_SCHEMA.properties,
        },
        idempotencyKey: {
          type: 'string',
          minLength: 1,
          maxLength: 200,
        },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['operation', 'input', 'confirm'],
      properties: {
        operation: { const: 'delete' },
        input: {
          type: 'object',
          additionalProperties: false,
          required: ['id'],
          properties: {
            id: {
              type: 'string',
              minLength: 1,
            },
          },
        },
        confirm: { const: true },
      },
    },
  ],
} as const;

export const CLI_CAPABILITIES = {
  compatibility: {
    deprecatedOptions: DEPRECATED_OPTIONS,
  },
  globalOptions: {
    fields: {
      supported: true,
      appliesTo: 'data',
      preservesEnvelope: true,
    },
    quiet: {
      supported: true,
      outputFormats: ['table'],
    },
    timeout: {
      supported: true,
      requiresUnit: true,
      units: ['ms', 's', 'm', 'h'],
    },
    retry: {
      automatic: false,
      option: '--max-retries',
      defaultMaxRetries: 0,
      maximumMaxRetries: 10,
      totalAttempts: '1 + maxRetries',
      requiresRetryableError: true,
      requiresIdempotentOperation: true,
      backoff: {
        strategy: 'exponential-with-jitter',
        baseDelayMs: 200,
        maxDelayMs: 5_000,
      },
      respectsRetryAfterMs: true,
      sharesTotalTimeoutBudget: true,
    },
    logging: {
      supported: true,
      defaultEnabled: false,
      sink: 'file',
      formats: ['json', 'text'],
      levels: ['error', 'warn', 'info', 'debug'],
      schemaVersion: 'notes.log/v1',
      correlatedBy: 'requestId',
      stdoutUnaffected: true,
      stderrUnaffected: true,
    },
  },
  standardStreams: {
    explicitInputMarker: '-',
    explicitOutputMarker: '-',
    implicitStdinRead: false,
    handlesBrokenPipe: true,
  },
  commands: {
    capabilities: {
      readOnly: true,
      destructive: false,
      interactive: false,
      supportsDryRun: false,
      supportsStructuredInput: false,
    },
    doctor: {
      readOnly: true,
      destructive: false,
      interactive: false,
      supportsDryRun: false,
      supportsStructuredInput: false,
      aggregatesFailures: true,
      checkStatuses: ['pass', 'warn', 'fail', 'skip'],
    },
    'schema.create': {
      readOnly: true,
      destructive: false,
      interactive: false,
      supportsDryRun: false,
      supportsStructuredInput: false,
    },
    'schema.batch': {
      readOnly: true,
      destructive: false,
      interactive: false,
      supportsDryRun: false,
      supportsStructuredInput: false,
    },
    batch: {
      readOnly: false,
      destructive: true,
      interactive: false,
      supportsDryRun: false,
      supportsStructuredInput: true,
      inputFormat: 'jsonl',
      requiredOutputFormat: 'jsonl',
      inputSchema: BATCH_ITEM_SCHEMA.$id,
      supportedOperations: ['create', 'delete'],
      supportsFailFast: true,
      supportsCancellation: true,
      cancellationSummary: true,
      cancellationCodes: ['OPERATION_TIMEOUT', 'OPERATION_CANCELLED'],
      cancellationExitCodes: {
        timeout: 124,
        SIGINT: 130,
        SIGTERM: 143,
      },
      atomic: false,
    },
    create: {
      readOnly: false,
      destructive: false,
      interactive: true,
      supportsDryRun: true,
      supportsStructuredInput: true,
      supportsIdempotencyKey: true,
      idempotencyRequired: false,
      automaticRetryRequiresIdempotencyKey: true,
      inputSchema: CREATE_NOTE_INPUT_SCHEMA.$id,
    },
    get: {
      readOnly: true,
      destructive: false,
      interactive: false,
      supportsDryRun: false,
      supportsStructuredInput: false,
      supportsAutomaticRetry: true,
    },
    list: {
      readOnly: true,
      destructive: false,
      interactive: false,
      supportsDryRun: false,
      supportsStructuredInput: false,
      supportsAutomaticRetry: true,
    },
    update: {
      readOnly: false,
      destructive: false,
      interactive: false,
      supportsDryRun: true,
      supportsStructuredInput: false,
      supportsAutomaticRetry: false,
    },
    delete: {
      readOnly: false,
      destructive: true,
      interactive: true,
      requiresConfirmation: true,
      supportsDryRun: true,
      supportsStructuredInput: false,
      supportsAutomaticRetry: false,
    },
    search: {
      readOnly: true,
      destructive: false,
      interactive: false,
      supportsDryRun: false,
      supportsStructuredInput: false,
      supportsAutomaticRetry: true,
    },
    export: {
      readOnly: false,
      destructive: false,
      interactive: true,
      supportsDryRun: true,
      supportsStructuredInput: false,
      writesExternalFile: true,
      supportsRawStdout: true,
      rawStdoutFormats: ['json', 'csv'],
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
    'config.effective': {
      readOnly: true,
      destructive: false,
      interactive: false,
      supportsDryRun: false,
      supportsStructuredInput: false,
      explainsConfigurationSources: true,
      exposesSensitiveValues: false,
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
