import { describe, expect, it } from 'vitest';
import {
  DEPRECATED_OPTIONS,
  deprecatedOption,
} from '../../../src/protocol/deprecations.js';

describe('deprecation metadata', () => {
  it('resolves deprecated options by long and short name', () => {
    expect(deprecatedOption('--format')).toBe(DEPRECATED_OPTIONS[0]);
    expect(deprecatedOption('-f')).toBe(DEPRECATED_OPTIONS[0]);
  });

  it('returns undefined for supported options', () => {
    expect(deprecatedOption('--output')).toBeUndefined();
  });
});
