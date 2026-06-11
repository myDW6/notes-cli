# notes-cli

A local notes CLI built with TypeScript and Commander. It supports both
interactive terminal use and deterministic, machine-readable Agent workflows.

## Installation

```bash
npm install -g @shaodw/notes-cli
```

## Usage

```bash
# List all notes
notes list

# Create a note
notes create --title "Hello" --content "World"
notes create

# Create from structured input
notes create --input note.json
cat note.json | notes create --input - --output json

# Make automated create retries safe
notes create --title "Agent note" --idempotency-key task-123 --output json

# Get a note by ID
notes get <id>

# Search notes
notes search "keyword"

# Update a note
notes update <id> --title "New title"

# Delete a note (requires --yes)
notes delete <id> --yes

# Preview a write without changing data
notes delete <id> --dry-run --output json

# Discover commands and structured input
notes capabilities --output json
notes schema create --output json
notes schema batch --output json

# Execute create/delete operations from JSONL
notes batch --input-jsonl operations.jsonl --output jsonl
notes batch --input-jsonl operations.jsonl --output jsonl --timeout 30s

# Export notes
notes export backup.json --export-format json
notes export backup.csv --export-format csv
notes export - --export-format json > backup.json

# Project result fields or suppress successful table output
notes list --output json --fields id,title
notes delete <id> --yes --quiet

# Interactively edit a note
notes interactive-edit

# Initialize config
notes config init

# Explain the final configuration and where every value came from
notes config effective --output json

# Diagnose runtime, configuration, data directory, and storage health
notes doctor --output json
```

## Global Options

| Option | Description |
|--------|-------------|
| `-o, --output <format>` | Output format: `table`, `json`, or `jsonl` |
| `--pretty` | Pretty-print JSON output |
| `--fields <fields>` | Include comma-separated fields from result data |
| `--quiet` | Suppress successful table output |
| `--no-input` | Disable interactive prompts |
| `--interactive` | Require interactive prompts and a TTY |
| `--timeout <duration>` | Cancel after a duration with unit, such as `500ms`, `30s`, or `5m` |
| `--config <path>` | Config directory |
| `--data-dir <path>` | Override the configured data directory |

## Agent usage

For deterministic automation, explicitly disable prompts and request JSON:

```bash
notes create \
  --title "Agent note" \
  --no-input \
  --output json
```

Successful machine output uses a stable envelope:

```json
{
  "ok": true,
  "apiVersion": "notes.cli/v1",
  "command": "create",
  "requestId": "req_...",
  "data": {
    "id": "..."
  }
}
```

Failures return a non-zero exit code, leave stdout empty, and write a structured
error envelope to stderr. Machine-readable output never prompts or includes
colors and success decorations.

Agents can discover supported operations and construct structured requests
without parsing help text:

```bash
notes capabilities --output json
notes schema create --output json
notes config effective --output json
notes doctor --output json
```

The create schema rejects unknown fields instead of silently ignoring likely
typos.

## Configuration precedence

Configuration is resolved in one place using this priority:

```text
command-line option > environment variable > config file > built-in default
```

`notes config effective --output json` returns each final value together with
its `source` and `sourceName`. Relative `--config`, `--data-dir`, and environment
paths resolve from the current working directory. Relative paths stored in
`config.json` resolve from the config directory.

Invalid environment values or malformed config files are reported as config
errors instead of being silently replaced by defaults.

## Compatibility

The machine protocol remains `notes.cli/v1` across compatible CLI releases.
The deprecated `--format`/`-f` option is still accepted as a hidden alias for
`--output`, with removal planned for CLI `2.0.0`.

Automated clients should read deprecation metadata from:

```bash
notes capabilities --output json
```

Successful human-readable invocations using the deprecated alias print a
warning to stderr. Machine-readable output and structured error documents are
not mixed with warning text.

## Project structure

The CLI entry point is a composition root. Global parsing and runtime state live
under `src/cli/`, while command use cases are registered from `src/commands/`.
Configuration, notes, batch, and Agent protocol modules have their own
directories and do not depend on Commander. See
[`docs/architecture.md`](docs/architecture.md) for the dependency rules.
Tests live under `tests/unit/` and `tests/integration/`.

## Diagnostics

`notes doctor` performs read-only checks with stable IDs and the statuses
`pass`, `warn`, `fail`, and `skip`. It continues independent checks after a
failure and never changes permissions or configuration.

A completed diagnostic run uses the normal success envelope. When one or more
checks fail, `data.status` is `fail` and the process exits with code `1`.

## Cancellation and timeouts

The process entry point converts `SIGINT`, `SIGTERM`, and `--timeout` into one
`AbortSignal`. Cooperative operations stop only at safe boundaries.

JSONL batch cancellation appends a structured `type: "summary"` line and uses
stable exit codes:

```text
timeout  124
SIGINT   130
SIGTERM  143
```

Timeout values require units. `--timeout 30` is rejected.

## Diagnostic logging

Logging is disabled by default and uses a separate file so stdout and stderr
keep their existing protocols:

```bash
notes list --output json --log-file ./notes.log
notes list --output json --log-file ./notes.log --log-level debug
notes list --log-file ./notes.log --log-format text
```

JSON is the default log format. Each JSONL event includes `schemaVersion`,
`timestamp`, `level`, `event`, `requestId`, and `command`. The `requestId`
matches the success or error response envelope.

Supported levels are `error`, `warn`, `info`, and `debug`. `--log-level` and
`--log-format` require `--log-file`; logs never share stdout with results or
stderr with structured machine errors.

## Automatic retries

Retries are disabled by default. Safe commands can opt in with:

```bash
notes list --output json --max-retries 3
notes create --title "CLI" \
  --idempotency-key request-123 \
  --max-retries 3 \
  --output json
```

`--max-retries 3` means one initial attempt plus at most three retries. The CLI
only retries structured errors marked `retryable: true`, uses bounded
exponential backoff with jitter, and honors `details.retryAfterMs`.

Read operations are retry-safe. Create requires `--idempotency-key`; unsafe
writes fail with `UNSAFE_RETRY` before execution. The command-wide `--timeout`
includes operation time and backoff waits instead of resetting for each attempt.

## Unix composition

Use `-` only when explicitly reading from stdin or writing raw export content to
stdout:

```bash
cat note.json | notes create --input - --output json
notes export - --export-format json | gzip > backup.json.gz
notes list --output json --fields id,title | jq '.data.items'
```

Raw export stdout contains file content, not the CLI response envelope. Output
redirection does not implicitly change the selected output format. Shell scripts
using pipelines should enable `set -o pipefail`.

## Configuration

Config file location: `~/.config/notes-cli/config.json`

Environment variables:
- `NOTES_DATA_DIR` - Data directory override
- `NOTES_FORMAT` - Default output format (`table` or `json`)

## License

MIT
