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

# Export notes
notes export backup.json --export-format json
notes export backup.csv --export-format csv

# Interactively edit a note
notes interactive-edit

# Initialize config
notes config init
```

## Global Options

| Option | Description |
|--------|-------------|
| `-o, --output <format>` | Output format: `table`, `json`, or `jsonl` |
| `--pretty` | Pretty-print JSON output |
| `--no-input` | Disable interactive prompts |
| `--interactive` | Require interactive prompts and a TTY |
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
```

The create schema rejects unknown fields instead of silently ignoring likely
typos.

## Configuration

Config file location: `~/.config/notes-cli/config.json`

Environment variables:
- `NOTES_DATA_DIR` — Data directory override
- `NOTES_FORMAT` — Default output format

## License

MIT
