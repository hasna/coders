# @hasna/coders

Open-source coding agent CLI with native @hasna/* ecosystem integration

[![npm](https://img.shields.io/npm/v/@hasna/coders)](https://www.npmjs.com/package/@hasna/coders)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/coders
```

## CLI Usage

```bash
coders --help
```

### Compact Output Defaults

Coders keeps human and agent-facing output compact by default. List and status
commands show essential fields, cap row counts, truncate long text, and include
hints for the next detail command.

Use gradual disclosure when you need more:

```bash
coders mcp list --limit 50 --verbose
coders plugin list --builtin --limit 50 --verbose
coders mcp get <name> --json
coders plugin list --json
```

The same policy applies to interactive slash commands and tool results. Large
tool outputs are summarized before they are returned to the model; use explicit
`limit`, `verbose`, filters, pagination, or detail tools such as `TaskGet`,
`TaskOutput`, and `ReadMcpResourceTool` to inspect more deliberately.

## Cloud Sync

This package supports cloud sync via `@hasna/cloud`:

```bash
cloud setup
cloud sync push --service coders
cloud sync pull --service coders
```

## Data Directory

Data is stored in `~/.hasna/coders/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
