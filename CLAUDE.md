# open-coders — Project Rules

## ABSOLUTE: Never Truncate User-Visible Text

- **NEVER use `.slice()`, `.substring()`, or character limits on text the user will read** — AI responses, tool results, thinking output
- **NEVER drop text deltas** — every `onTextDelta` callback must accumulate ALL text, regardless of tool state
- **Streaming preview can show last N lines** for display purposes, but the FULL text must be stored and committed to the conversation
- **The final committed message must contain 100% of the API response text** — no truncation, no filtering
- If you see `.slice(-200)` or `.slice(0, 120)` on user-visible content, it's a bug. Fix it.

## UI Rules

- **Interactive pickers**: When a slash command like `/model`, `/effort`, `/theme`, `/plan` is called with NO args, it MUST open an interactive picker (up/down selector) — never show text like "use /model <name>"
- **Always accumulate streaming text**: `onTextDelta` must always call `setStreaming(prev => prev + text)` with no conditions
- **Static zone = permanent**: Completed messages go to Ink's `<Static>` and must never be lost
- **Dynamic zone = ephemeral**: Active tools, spinners, pickers live here and re-render freely

## Interactive Component Design System

All slash commands follow a standard interactive pattern when called with no args:

### Standard Components

1. **Picker** — vertical list with ▸ cursor
   - ↑↓ navigate (wraps around)
   - Enter selects
   - Escape closes
   - Tab cycles between related pickers
   - Current value shown with ✓
   - Windowed display (max 8-10 visible, shows "↑ N more" / "↓ N more")
   - Used by: `/model`, `/effort`, `/theme`, `/plan`, `/config`

2. **Toggle** — boolean flip on Enter
   - Shows ✓ on / ✗ off
   - Used by: `/config` for boolean settings, `/verbose`, `/vim`

3. **Text output** — for data display commands
   - Used by: `/status`, `/cost`, `/diff`, `/files`, `/history`, `/session`
   - These show information, no interaction needed

### Rules for New Commands

- If a command has **selectable options** → use Picker
- If a command shows **data** → use text output
- If a command **toggles state** → use Toggle
- **NEVER show "use /command <value>"** — always open a picker instead
- All pickers must support: ↑↓ wrap, Enter select, Escape close, windowed scroll

### Implementation Pattern

```typescript
// In slash-commands.ts:
handler: (args) => {
  if (args) return { action: "myAction", data: args.trim() };
  return { action: "myAction" }; // no data = open picker
}

// In app.tsx action handler:
if (r.action === "myAction") {
  if (r.data) { /* apply directly */ }
  else { setActivePicker("myType"); setPickerIndex(0); }
}
```

## Architecture

- Terminal UI: Ink (React for terminal) — `src/ui/app.tsx`
- Slash commands: `src/core/slash-commands.ts` — handlers return `{ action, data?, output? }`
- Agent loop: `src/core/agent-loop.ts` — tool execution, streaming, multi-turn
- Web dashboard: `src/web/server.ts` — HTTP + WebSocket, `src/web/dashboard.ts` — HTML SPA
- Models: `src/api/models.ts` — MODEL_REGISTRY with provider variants
- Config: `src/config/settings.ts` + `src/config/loader.ts`

## Testing

- Always build (`npm run build`) after changes
- Test slash commands in tmux: `tmux new-session -d -s test && tmux send-keys -t test "node dist/cli.mjs" Enter`
- Typecheck: `npx tsc --noEmit`
