/**
 * Instructions file processing — CODERS.md / CLAUDE.md
 *
 * Reads and caches project instructions files.
 * Supports: CODERS.md (primary), removed.
 * Strips HTML comments, warns on external includes.
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getInstructionsFilePath, getConfigDir } from "../config/paths.js";

let _cache = new Map<string, string>();

/**
 * Get the instructions content for a project directory.
 */
export function getInstructionsContent(projectDir: string): string | null {
  const cached = _cache.get(projectDir);
  if (cached !== undefined) return cached || null;

  const filePath = getInstructionsFilePath(projectDir);
  if (!filePath) {
    _cache.set(projectDir, "");
    return null;
  }

  try {
    let content = readFileSync(filePath, "utf-8");
    content = stripHtmlComments(content);
    _cache.set(projectDir, content);
    return content;
  } catch {
    _cache.set(projectDir, "");
    return null;
  }
}

/**
 */
export function getGlobalInstructions(): string | null {
  const configDir = getConfigDir();
  const primary = join(configDir, "CODERS.md");

  const path = existsSync(primary) ? primary : null;
  if (!path) return null;

  try {
    return stripHtmlComments(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Build the full system prompt from instructions files.
 */
export function buildInstructionsPrompt(projectDir: string): string {
  const parts: string[] = [];

  const global = getGlobalInstructions();
  if (global) parts.push(`# Global Instructions\n\n${global}`);

  const project = getInstructionsContent(projectDir);
  if (project) parts.push(`# Project Instructions\n\n${project}`);

  // Check for .coders/rules/ directory (modular rules like Claude Code)
  const rulesDir = join(projectDir, ".coders", "rules");
  if (existsSync(rulesDir)) {
    try {
      const { readdirSync } = require("fs");
      for (const file of readdirSync(rulesDir) as string[]) {
        if (!file.endsWith(".md")) continue;
        const content = readFileSync(join(rulesDir, file), "utf-8");
        parts.push(`# Rule: ${file}\n\n${stripHtmlComments(content)}`);
      }
    } catch { /* ignore */ }
  }

  return parts.join("\n\n---\n\n");
}

export function clearInstructionsCache(): void {
  _cache.clear();
}

function stripHtmlComments(content: string): string {
  return content.replace(/<!--[\s\S]*?-->/g, "");
}
