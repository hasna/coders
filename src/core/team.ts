/**
 * Team/multi-agent coordination
 *
 * Create teams, spawn teammates, assign tasks, coordinate work.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { getTeamsDir, getTasksDir } from "../config/paths.js";

export interface Team {
  name: string;
  description?: string;
  createdAt: string;
  members: TeamMember[];
  taskListId: string;
}

export interface TeamMember {
  name: string;
  agentId?: string;
  role?: string;
  status: "active" | "idle" | "offline";
  currentTask?: string;
}

export function createTeam(name: string, description?: string): Team {
  const team: Team = {
    name,
    description,
    createdAt: new Date().toISOString(),
    members: [],
    taskListId: name,
  };

  // Create team config file
  const teamsDir = getTeamsDir();
  writeFileSync(join(teamsDir, `${name}.json`), JSON.stringify(team, null, 2), "utf-8");

  // Create task list directory
  const taskDir = join(getTasksDir(), name);
  if (!existsSync(taskDir)) mkdirSync(taskDir, { recursive: true });

  return team;
}

export function getTeam(name: string): Team | null {
  const path = join(getTeamsDir(), `${name}.json`);
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf-8")); } catch { return null; }
}

export function addTeamMember(teamName: string, member: TeamMember): void {
  const team = getTeam(teamName);
  if (!team) return;
  team.members = team.members.filter(m => m.name !== member.name);
  team.members.push(member);
  writeFileSync(join(getTeamsDir(), `${teamName}.json`), JSON.stringify(team, null, 2), "utf-8");
}

export function updateMemberStatus(teamName: string, memberName: string, status: TeamMember["status"]): void {
  const team = getTeam(teamName);
  if (!team) return;
  const member = team.members.find(m => m.name === memberName);
  if (member) {
    member.status = status;
    writeFileSync(join(getTeamsDir(), `${teamName}.json`), JSON.stringify(team, null, 2), "utf-8");
  }
}

export function listTeams(): string[] {
  const dir = getTeamsDir();
  if (!existsSync(dir)) return [];
  const { readdirSync } = require("fs");
  return readdirSync(dir)
    .filter((f: string) => f.endsWith(".json"))
    .map((f: string) => f.replace(".json", ""));
}
