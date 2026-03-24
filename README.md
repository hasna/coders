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
