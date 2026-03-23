/**
 * Hook system — register and execute hooks at key lifecycle points
 *
 * Hook events: SessionStart, Setup, PreToolUse, PostToolUse, Stop,
 * WorktreeCreate, InstructionsLoaded, UserPromptSubmit
 */
import { exec } from "child_process";
import { promisify } from "util";
const execAsync = promisify(exec);
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
        const { stdout } = await execAsync(cmd.command, {
          timeout: cmd.timeout ?? 30_000,
          encoding: "utf-8",
          env: {
            ...process.env,
            CODERS_HOOK_EVENT: event,
            CODERS_TOOL_NAME: context?.toolName ?? "",
          },
        });

        // Only block if stdout starts with "BLOCK:" prefix (explicit opt-in)
        const output = (stdout ?? "").trim();
        if (output.startsWith("BLOCK:")) {
          return { blocked: true, message: output.slice(6).trim() };
        }
      } catch (error) {
        // Non-zero exit code = blocking (hook signaling rejection)
        const err = error as any;
        if (err.code && err.code !== 0) {
          const msg = (err.stderr ?? err.message ?? "").trim();
          if (msg) return { blocked: true, message: msg };
        }
        console.error(`[hooks] ${event} hook failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  return { blocked: false };
}

/**
 * Load hooks from settings into the registry.
 */
const VALID_HOOK_EVENTS = new Set<string>(["SessionStart", "Setup", "PreToolUse", "PostToolUse", "Stop", "WorktreeCreate", "InstructionsLoaded", "UserPromptSubmit"]);

export function loadHooksFromSettings(
  hooksConfig: Record<string, HookCommand[]>,
): void {
  for (const [event, commands] of Object.entries(hooksConfig)) {
    if (!VALID_HOOK_EVENTS.has(event)) {
      console.warn(`[hooks] Ignoring unknown hook event: "${event}". Valid events: ${[...VALID_HOOK_EVENTS].join(", ")}`);
      continue;
    }
    registerHook({
      event: event as HookEvent,
      commands,
      source: "settings",
    });
  }
}

export function getRegisteredHookCount(): number { return hooks.length; }
