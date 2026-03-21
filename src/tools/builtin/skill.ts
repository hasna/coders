/**
 * Skill tool — invoke user-defined skills from SKILL.md files.
 *
 * Skills are defined as directories under .coders/skills/ or .claude/skills/
 * containing a SKILL.md file with YAML frontmatter (name, description) and a prompt body.
 *
 * When invoked, the skill's prompt is expanded and returned as context
 * for the AI to follow.
 *
 * Search locations (in order):
 *   1. <cwd>/.coders/skills/
 *   2. <cwd>/.claude/skills/
 *   3. ~/.coders/skills/
 *   4. ~/.claude/skills/
 */
import { z } from "zod";
import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { Tool, ToolCallResult, ToolResultBlockParam } from "../interface.js";
import { DEFAULT_MAX_RESULT_SIZE_CHARS } from "../../core/constants.js";

// ── Types ──────────────────────────────────────────────────────────

export interface SkillInfo {
  /** Skill name (from frontmatter or directory name) */
  name: string;
  /** Description (from frontmatter) */
  description: string;
  /** Absolute path to the SKILL.md file */
  path: string;
  /** Source: "project" (.coders/skills or .claude/skills in cwd) or "user" (home dir) */
  source: "project" | "user";
}

interface ParsedSkill {
  name: string;
  description: string;
  body: string;
}

// ── YAML Frontmatter Parser (lightweight, no external deps) ────────

function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const rawYaml = match[1];
  const body = match[2];
  const frontmatter: Record<string, string> = {};

  for (const line of rawYaml.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    let value = trimmed.slice(colonIdx + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    frontmatter[key] = value;
  }

  return { frontmatter, body };
}

// ── Skill Parsing ──────────────────────────────────────────────────

function parseSkillFile(filePath: string, dirName: string): ParsedSkill | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(content);

    return {
      name: frontmatter.name || dirName,
      description: frontmatter.description || "",
      body: body.trim(),
    };
  } catch {
    return null;
  }
}

// ── Skill Discovery ────────────────────────────────────────────────

/**
 * Scan a single skills directory and return all valid skills found.
 */
function scanSkillsDir(baseDir: string, source: "project" | "user"): SkillInfo[] {
  if (!existsSync(baseDir)) return [];

  const skills: SkillInfo[] = [];

  try {
    const entries = readdirSync(baseDir);
    for (const entry of entries) {
      const entryPath = join(baseDir, entry);

      // Each skill is a directory containing SKILL.md
      try {
        if (!statSync(entryPath).isDirectory()) continue;
      } catch {
        continue;
      }

      const skillFile = join(entryPath, "SKILL.md");
      if (!existsSync(skillFile)) continue;

      const parsed = parseSkillFile(skillFile, entry);
      if (!parsed) continue;

      skills.push({
        name: parsed.name,
        description: parsed.description,
        path: skillFile,
        source,
      });
    }
  } catch {
    // Directory read failed — skip silently
  }

  return skills;
}

/**
 * Discover all available skills from all search locations.
 * Skills in project directories take precedence over user-level skills
 * with the same name.
 *
 * @param cwd - Current working directory (project root)
 */
export function discoverSkills(cwd?: string): SkillInfo[] {
  const projectDir = cwd ?? process.cwd();
  const home = homedir();

  // Scan all locations
  const projectCoders = scanSkillsDir(join(projectDir, ".coders", "skills"), "project");
  const projectClaude = scanSkillsDir(join(projectDir, ".claude", "skills"), "project");
  const userCoders = scanSkillsDir(join(home, ".coders", "skills"), "user");
  const userClaude = scanSkillsDir(join(home, ".claude", "skills"), "user");

  // Merge with project skills taking precedence (first seen wins)
  const seen = new Set<string>();
  const all: SkillInfo[] = [];

  for (const list of [projectCoders, projectClaude, userCoders, userClaude]) {
    for (const skill of list) {
      const key = skill.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(skill);
    }
  }

  return all;
}

// ── Tool Name Constant ─────────────────────────────────────────────

export const SKILL_TOOL = "Skill" as const;

// ── Input / Output Schemas ─────────────────────────────────────────

const skillInputSchema = z.strictObject({
  skill: z.string().describe("The skill name to invoke (e.g. 'commit', 'review-pr', 'test')"),
  args: z.string().optional().describe("Optional arguments to pass to the skill prompt"),
});

type SkillInput = z.infer<typeof skillInputSchema>;

interface SkillOutput {
  skill: string;
  prompt: string;
  source: "project" | "user";
  error?: string;
}

// ── Skill Tool Implementation ──────────────────────────────────────

export const skillTool: Tool<SkillInput, SkillOutput> = {
  name: SKILL_TOOL,
  searchHint: "invoke user-defined skill from SKILL.md",
  maxResultSizeChars: DEFAULT_MAX_RESULT_SIZE_CHARS,
  shouldDefer: false,
  strict: false,

  async description() {
    return "Execute a skill within the main conversation. Skills are user-defined prompts in .coders/skills/ or .claude/skills/ directories.";
  },

  async prompt() {
    return `Invoke a user-defined skill from .coders/skills/ or .claude/skills/ directories.
Skills are directories containing a SKILL.md file with YAML frontmatter (name, description) and a markdown prompt body.
When invoked, the skill's prompt is returned with {{args}} replaced by the provided args.
Use this tool when the user references a skill by name or uses a "/<skill-name>" slash command pattern.`;
  },

  get inputSchema() {
    return skillInputSchema as any;
  },

  get outputSchema() {
    return z.any() as any;
  },

  userFacingName() {
    return SKILL_TOOL;
  },

  isEnabled() {
    return true;
  },

  isConcurrencySafe() {
    return true;
  },

  isReadOnly() {
    return true;
  },

  toAutoClassifierInput(input: SkillInput) {
    return `skill:${input.skill}${input.args ? ` ${input.args}` : ""}`;
  },

  getActivityDescription(input: SkillInput) {
    return `Running skill: ${input.skill}`;
  },

  getToolUseSummary(input: SkillInput) {
    return input.skill;
  },

  async checkPermissions(input: SkillInput) {
    return { behavior: "allow" as const, updatedInput: input };
  },

  async validateInput(input: SkillInput) {
    if (!input.skill || typeof input.skill !== "string") {
      return { result: false, message: "skill name is required" };
    }
    return { result: true };
  },

  async call(input: SkillInput): Promise<ToolCallResult<SkillOutput>> {
    const skillName = input.skill.trim().toLowerCase();
    const skills = discoverSkills();

    // Find the matching skill (case-insensitive)
    const match = skills.find((s) => s.name.toLowerCase() === skillName);

    if (!match) {
      // List available skills in the error message
      const available = skills.map((s) => s.name).join(", ");
      const errorMsg = available
        ? `Skill "${input.skill}" not found. Available skills: ${available}`
        : `Skill "${input.skill}" not found. No skills are installed. Create a skill directory with a SKILL.md file in .coders/skills/ or .claude/skills/.`;

      return {
        data: {
          skill: input.skill,
          prompt: "",
          source: "project",
          error: errorMsg,
        },
      };
    }

    // Parse the skill file to get the full body
    const parsed = parseSkillFile(match.path, match.name);
    if (!parsed || !parsed.body) {
      return {
        data: {
          skill: input.skill,
          prompt: "",
          source: match.source,
          error: `Skill "${match.name}" has an empty or invalid SKILL.md file at ${match.path}`,
        },
      };
    }

    // Expand {{args}} placeholder
    let prompt = parsed.body;
    if (input.args) {
      prompt = prompt.replace(/\{\{args\}\}/g, input.args);
    } else {
      // Remove unfilled {{args}} placeholders
      prompt = prompt.replace(/\{\{args\}\}/g, "");
    }

    return {
      data: {
        skill: match.name,
        prompt: prompt.trim(),
        source: match.source,
      },
    };
  },

  mapToolResultToToolResultBlockParam(result: SkillOutput, toolUseId: string): ToolResultBlockParam {
    if (result.error) {
      return {
        type: "tool_result",
        tool_use_id: toolUseId,
        content: result.error,
        is_error: true,
      };
    }

    // Return the skill prompt as context for the AI to follow
    return {
      type: "tool_result",
      tool_use_id: toolUseId,
      content: `<command-name>${result.skill}</command-name>\n\n${result.prompt}`,
    };
  },
};
