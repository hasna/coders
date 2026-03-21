/**
 * Team/multi-agent coordination
 *
 * Create teams, spawn teammates, assign tasks, coordinate work.
 * Uses SQLite via src/db/index.ts (tables: teams, team_members).
 */
import { dbRun, dbGet, dbAll } from "../db/index.js";

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
  const now = new Date().toISOString();

  dbRun(
    `INSERT OR IGNORE INTO teams (name, description, task_list_id, created_at) VALUES (?, ?, ?, ?)`,
    [name, description ?? null, name, now],
  );

  return {
    name,
    description,
    createdAt: now,
    members: [],
    taskListId: name,
  };
}

export function getTeam(name: string): Team | null {
  const row = dbGet<any>(`SELECT * FROM teams WHERE name = ?`, [name]);
  if (!row) return null;

  const members = dbAll<any>(
    `SELECT * FROM team_members WHERE team_name = ?`,
    [name],
  );

  return {
    name: row.name,
    description: row.description ?? undefined,
    createdAt: row.created_at ?? "",
    taskListId: row.task_list_id ?? row.name,
    members: members.map((m: any) => ({
      name: m.agent_name,
      agentId: m.agent_name,
      role: m.role ?? undefined,
      status: m.status ?? "idle",
      currentTask: m.current_task ?? undefined,
    })),
  };
}

export function addTeamMember(teamName: string, member: TeamMember): void {
  // Upsert: remove existing entry for this agent, then insert
  dbRun(
    `DELETE FROM team_members WHERE team_name = ? AND agent_name = ?`,
    [teamName, member.name],
  );
  dbRun(
    `INSERT INTO team_members (team_name, agent_name, role, status, current_task) VALUES (?, ?, ?, ?, ?)`,
    [teamName, member.name, member.role ?? null, member.status, member.currentTask ?? null],
  );
}

export function updateMemberStatus(teamName: string, memberName: string, status: TeamMember["status"]): void {
  dbRun(
    `UPDATE team_members SET status = ? WHERE team_name = ? AND agent_name = ?`,
    [status, teamName, memberName],
  );
}

export function listTeams(): string[] {
  const rows = dbAll<any>(`SELECT name FROM teams`);
  return rows.map((r: any) => r.name);
}
