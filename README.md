# notes-cli

A simple CLI for managing local notes, built with TypeScript and Commander.

## Installation

```bash
npm install -g notes-cli
```

## Usage

```bash
# List all notes
notes list

# Create a note (interactive TUI when no flags provided)
notes create --title "Hello" --content "World"
notes create

# Get a note by ID
notes get <id>

# Search notes
notes search "keyword"

# Update a note
notes update <id> --title "New title"

# Delete a note (requires --yes)
notes delete <id> --yes

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
| `-f, --format <fmt>` | Output format: `json` or `table` |
| `--pretty` | Colorize JSON output |
| `--config <path>` | Config directory |

## Configuration

Config file location: `~/.config/notes-cli/config.json`

Environment variables:
- `NOTES_DATA_DIR` — Data directory override
- `NOTES_FORMAT` — Default output format

## License

MIT
