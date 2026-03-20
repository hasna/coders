/**
 * Speculation engine — pre-execute likely next tools while user types
 *
 * Creates an overlay filesystem for speculative writes.
 * Rolls back if user rejects, commits if accepted.
 */
import { mkdirSync, existsSync, cpSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { ToolPermissionContext } from "../config/permissions.js";
import { READ_ONLY_TOOLS, WRITE_TOOLS } from "./constants.js";

export interface SpeculationState {
  active: boolean;
  overlayDir: string | null;
  executedTools: Array<{ name: string; input: unknown; result: unknown }>;
  timeSavedMs: number;
  startTime: number;
}

let state: SpeculationState = {
  active: false, overlayDir: null, executedTools: [], timeSavedMs: 0, startTime: 0,
};

export function getSpeculationState(): SpeculationState { return state; }

export function startSpeculation(): SpeculationState {
  const overlayDir = join(tmpdir(), `coders-speculation-${Date.now()}`);
  mkdirSync(overlayDir, { recursive: true });
  state = { active: true, overlayDir, executedTools: [], timeSavedMs: 0, startTime: performance.now() };
  return state;
}

export function stopSpeculation(): void {
  if (state.overlayDir && existsSync(state.overlayDir)) {
    rmSync(state.overlayDir, { recursive: true, force: true });
  }
  state = { active: false, overlayDir: null, executedTools: [], timeSavedMs: 0, startTime: 0 };
}

export function acceptSpeculation(targetDir: string): number {
  if (!state.active || !state.overlayDir) return 0;
  // Copy overlay files to real filesystem
  if (existsSync(state.overlayDir)) {
    try { cpSync(state.overlayDir, targetDir, { recursive: true }); } catch { /* partial copy ok */ }
  }
  const saved = performance.now() - state.startTime;
  state.timeSavedMs += saved;
  const total = state.timeSavedMs;
  stopSpeculation();
  return total;
}

export function canSpeculateOnTool(toolName: string, permContext: ToolPermissionContext): boolean {
  // Read-only tools always allowed
  if (READ_ONLY_TOOLS.has(toolName)) return true;

  // Write tools only in permissive modes
  if (WRITE_TOOLS.has(toolName)) {
    return permContext.mode === "acceptEdits" || permContext.mode === "bypassPermissions";
  }

  // Bash: only if read-only detection passes (handled at call site)
  if (toolName === "Bash") return false; // conservative default

  return false;
}

export function recordSpeculativeExecution(name: string, input: unknown, result: unknown): void {
  if (state.active) state.executedTools.push({ name, input, result });
}

export function getSpeculationTimeSavedMs(): number { return state.timeSavedMs; }
