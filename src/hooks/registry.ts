/**
 * Hook system — register and execute hooks at key lifecycle points
 *
 * Hook events: SessionStart, Setup, PreToolUse, PostToolUse, Stop,
 * WorktreeCreate, InstructionsLoaded, UserPromptSubmit
 */
import { execSync } from "child_process";
import type { HookEvent, HookCommand } from "../config/settings.js";

export interface RegisteredHook {
  event: HookEvent;
  commands: HookCommand[];
  source: "settings" | "plugin";
}

const hooks: RegisteredHook[] = [];

export function registerHook(hook: RegisteredHook): void {
  hooks.push(hook);
}

export function registerHooks(newHooks: RegisteredHook[]): void {
  hooks.push(...newHooks);
}

export function clearHooks(): void {
  hooks.length = 0;
}

export function getHooksForEvent(event: HookEvent): RegisteredHook[] {
  return hooks.filter(h => h.event === event);
}

/**
 * Execute all hooks for an event. Returns blocking result if any hook blocks.
 */
export async function executeHooks(
  event: HookEvent,
  context?: { toolName?: string; toolInput?: unknown },
): Promise<{ blocked: boolean; message?: string }> {
  const eventHooks = getHooksForEvent(event);

  for (const hook of eventHooks) {
    for (const cmd of hook.commands) {
      try {
        const result = execSync(cmd.command, {
          timeout: cmd.timeout ?? 30_000,
          encoding: "utf-8",
          stdio: "pipe",
          env: {
            ...process.env,
            CODERS_HOOK_EVENT: event,
            CODERS_TOOL_NAME: context?.toolName ?? "",
          },
        });

        // Check for blocking result (non-empty stdout = blocking message)
        const output = result.trim();
        if (output) {
          return { blocked: true, message: output };
        }
      } catch (error) {
        // Hook failure = non-blocking by default
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[hooks] ${event} hook failed: ${msg}`);
      }
    }
  }

  return { blocked: false };
}

/**
 * Load hooks from settings into the registry.
 */
export function loadHooksFromSettings(
  hooksConfig: Record<string, HookCommand[]>,
): void {
  for (const [event, commands] of Object.entries(hooksConfig)) {
    registerHook({
      event: event as HookEvent,
      commands,
      source: "settings",
    });
  }
}

export function getRegisteredHookCount(): number { return hooks.length; }
