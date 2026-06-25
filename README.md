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

## Storage Sync

This package supports optional storage sync through a package-local Postgres connection:

```bash
export HASNA_CODERS_DATABASE_URL=postgres://...
coders storage status
coders storage push
coders storage pull
coders storage sync
```

`CODERS_DATABASE_URL` is accepted as the non-Hasna fallback database URL.

The MCP server also exposes `storage_status`, `storage_push`, `storage_pull`, and `storage_sync`.

## Data Directory

Data is stored in `~/.hasna/coders/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
