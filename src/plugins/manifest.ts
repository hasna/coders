/**
 * Plugin manifest schema — defines what a plugin can provide
 */
import { z } from "zod";

export const PluginSourceSchema = z.enum(["git", "url", "npm", "file", "directory"]);
export type PluginSource = z.infer<typeof PluginSourceSchema>;

export const PluginManifestSchema = z.object({
  name: z.string(),
  version: z.string().default("0.0.1"),
  description: z.string().optional(),
  author: z.string().optional(),

  // What the plugin provides
  commands: z.array(z.object({
    name: z.string(),
    description: z.string(),
    command: z.string(),
  })).optional(),

  skills: z.array(z.object({
    name: z.string(),
    description: z.string(),
    path: z.string(),
  })).optional(),

  mcpServers: z.record(z.string(), z.object({
    command: z.string(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
  })).optional(),

  lspServers: z.array(z.object({
    command: z.string(),
    args: z.array(z.string()).optional(),
    extensionToLanguage: z.record(z.string(), z.string()).optional(),
    transport: z.enum(["stdio", "socket"]).default("stdio"),
  })).optional(),

  hooks: z.record(z.string(), z.array(z.object({
    type: z.literal("command"),
    command: z.string(),
  }))).optional(),

  settings: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export type PluginManifest = z.infer<typeof PluginManifestSchema>;

export interface InstalledPlugin {
  name: string;
  version: string;
  source: PluginSource;
  sourcePath: string;
  manifest: PluginManifest;
  enabled: boolean;
  scope: "user" | "project";
  installedAt: string;
  lastUpdated: string;
}
