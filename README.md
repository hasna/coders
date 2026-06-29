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

## Data Directory

Data is stored locally in `~/.hasna/coders/`.

Set `CODERS_DB_PATH` to use a specific SQLite database path. Coders-owned
PostgreSQL migration helpers live in this package for future remote storage
adapters; the package does not depend on the retired shared cloud runtime.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
