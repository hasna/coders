# @hasna/coders

Open-source coding agent CLI — clean-room TypeScript reimplementation inspired by Claude Code, with native @hasna/* ecosystem integration.

## Stack

- **Runtime:** Node.js >= 18, ES Modules
- **Language:** TypeScript (strict mode)
- **UI:** Ink (React for terminals) + Yoga flexbox
- **CLI:** Commander.js
- **Validation:** Zod v4
- **HTTP:** Axios + HTTP/2 pooling
- **Streaming:** SSE (Server-Sent Events)
- **MCP:** @modelcontextprotocol/sdk
- **Bundler:** esbuild

## Project Structure

```
src/
├── cli/          # CLI entry point, subcommands
├── core/         # Agent loop, session, context, speculation
├── api/          # LLM API client, streaming, providers
├── auth/         # API key resolution, OAuth, secrets
├── tools/        # Tool registry + 15 built-in tools
├── mcp/          # MCP server & client
├── config/       # Configuration cascade
├── hooks/        # Hook system
├── git/          # Git integration
├── ui/           # Terminal UI (Ink)
├── plugins/      # Plugin & marketplace system
├── memory/       # CODERS.md processing, auto-memory
├── remote/       # Remote/bridge sessions
├── telemetry/    # OpenTelemetry events
├── integrations/ # Native @hasna/* integrations
└── utils/        # Shared utilities
```

## Development

```bash
bun install
bun run dev          # Run from source
bun run build        # Bundle with esbuild
bun run test         # Run tests
bun run typecheck    # Type check
```

## Config Directory

- Primary: `~/.coders/`
- Compat: reads `~/.claude/` as fallback
- Project: `.coders/settings.json`

## Instructions File

- Primary: `CODERS.md`
- Compat: reads `CLAUDE.md` as fallback
