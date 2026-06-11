export interface DeprecatedOption {
  name: string;
  shortName?: string;
  replacement: string;
  removalVersion: string;
}

export const DEPRECATED_OPTIONS: readonly DeprecatedOption[] = [
  {
    name: '--format',
    shortName: '-f',
    replacement: '--output',
    removalVersion: '2.0.0',
  },
];

export function deprecatedOption(name: string): DeprecatedOption | undefined {
  return DEPRECATED_OPTIONS.find(
    (option) => option.name === name || option.shortName === name,
  );
}
