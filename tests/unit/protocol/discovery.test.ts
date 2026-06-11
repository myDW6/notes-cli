import { describe, expect, it } from 'vitest';
import {
  BATCH_ITEM_SCHEMA,
  CLI_CAPABILITIES,
  CREATE_NOTE_INPUT_SCHEMA,
  validateCreateInput,
} from '../../../src/protocol/discovery.js';

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

  it('publishes explainable effective configuration support', () => {
    expect(CLI_CAPABILITIES.commands['config.effective']).toMatchObject({
      readOnly: true,
      explainsConfigurationSources: true,
      exposesSensitiveValues: false,
    });
  });

  it('publishes aggregate doctor diagnostics', () => {
    expect(CLI_CAPABILITIES.commands.doctor).toMatchObject({
      readOnly: true,
      interactive: false,
      aggregatesFailures: true,
      checkStatuses: ['pass', 'warn', 'fail', 'skip'],
    });
  });

  it('publishes deprecated option metadata for automated clients', () => {
    expect(CLI_CAPABILITIES.compatibility.deprecatedOptions).toContainEqual({
      name: '--format',
      shortName: '-f',
      replacement: '--output',
      removalVersion: '2.0.0',
    });
  });

  it('publishes timeout and batch cancellation contracts', () => {
    expect(CLI_CAPABILITIES.globalOptions.timeout).toMatchObject({
      supported: true,
      requiresUnit: true,
      units: ['ms', 's', 'm', 'h'],
    });
    expect(CLI_CAPABILITIES.commands.batch).toMatchObject({
      supportsCancellation: true,
      cancellationSummary: true,
      cancellationCodes: ['OPERATION_TIMEOUT', 'OPERATION_CANCELLED'],
      cancellationExitCodes: {
        timeout: 124,
        SIGINT: 130,
        SIGTERM: 143,
      },
    });
  });

  it('publishes the isolated diagnostic logging contract', () => {
    expect(CLI_CAPABILITIES.globalOptions.logging).toMatchObject({
      supported: true,
      defaultEnabled: false,
      sink: 'file',
      formats: ['json', 'text'],
      levels: ['error', 'warn', 'info', 'debug'],
      schemaVersion: 'notes.log/v1',
      correlatedBy: 'requestId',
      stdoutUnaffected: true,
      stderrUnaffected: true,
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
