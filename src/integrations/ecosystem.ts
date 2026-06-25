/**
 * Remaining @hasna/* ecosystem integrations
 *
 * Each wraps an optional @hasna/* package with graceful fallback.
 * Uses a unified pattern: try require(), cache result, expose methods.
 *
 * Packages: sessions, skills, configs, prompts, recordings,
 * sandboxes, economy, wallets, brains, attachments
 */

export interface IntegrationStatus {
  name: string;
  packageName: string;
  available: boolean;
  version?: string;
}

// ── Generic integration wrapper ────────────────────────────────────

class HasnaIntegration {
  readonly name: string;
  readonly packageName: string;
  private readonly envVar?: string;
  private client: Record<string, Function> | null = null;
  private _available: boolean | null = null;

  constructor(name: string, packageName: string, envVar?: string) {
    this.name = name;
    this.packageName = packageName;
    this.envVar = envVar;
  }

  private get moduleName(): string | null {
    if (!this.envVar) return this.packageName;
    return process.env[this.envVar]?.trim() || null;
  }

  get available(): boolean {
    if (this._available !== null) return this._available;
    try {
      const moduleName = this.moduleName;
      if (!moduleName) {
        this._available = false;
        return this._available;
      }
      const mod = require(moduleName);
      if (mod && typeof mod.createClient === "function") {
        this.client = mod.createClient();
        this._available = true;
      } else if (mod) {
        this.client = mod;
        this._available = true;
      } else {
        this._available = false;
      }
    } catch {
      this._available = false;
    }
    return this._available;
  }

  async call(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.available || !this.client) {
      if (this.envVar && !this.moduleName) {
        return {
          error: `${this.name} integration not configured. Set ${this.envVar} to a module name.`,
          available: false,
        };
      }
      return { error: `${this.packageName} not installed`, available: false };
    }
    const fn = this.client[method];
    if (typeof fn !== "function") {
      return { error: `Method ${method} not found on ${this.packageName}`, available: true };
    }
    return fn.call(this.client, params);
  }

  getStatus(): IntegrationStatus {
    return {
      name: this.name,
      packageName: this.packageName,
      available: this.available,
    };
  }
}

// ── All integrations ───────────────────────────────────────────────

const integrations = new Map<string, HasnaIntegration>();

function register(name: string, pkg: string, envVar?: string): void {
  integrations.set(name, new HasnaIntegration(name, pkg, envVar));
}

// Register all @hasna/* packages
register("sessions", "@hasna/sessions");
register("skills", "@hasna/skills");
register("configs", "@hasna/configs");
register("prompts", "@hasna/prompts");
register("recordings", "@hasna/recordings");
register("sandboxes", "@hasna/sandboxes");
register("economy", "@hasna/economy");
register("wallets", "$CODERS_WALLET_MODULE", "CODERS_WALLET_MODULE");
register("brains", "@hasna/brains");
register("attachments", "@hasna/attachments");

// ── Public API ─────────────────────────────────────────────────────

/**
 * Get a specific integration by name.
 */
export function getIntegration(name: string): HasnaIntegration | null {
  return integrations.get(name) ?? null;
}

/**
 * Get all integration statuses.
 */
export function getAllIntegrationStatuses(): IntegrationStatus[] {
  return [...integrations.values()].map((i) => i.getStatus());
}

/**
 * Initialize all available integrations.
 * Returns which ones are available.
 */
export function initializeAllIntegrations(): IntegrationStatus[] {
  const statuses: IntegrationStatus[] = [];

  for (const integration of integrations.values()) {
    statuses.push(integration.getStatus());
  }

  return statuses;
}

/**
 * Call a method on a specific integration.
 */
export async function callIntegration(
  name: string,
  method: string,
  params?: Record<string, unknown>,
): Promise<unknown> {
  const integration = integrations.get(name);
  if (!integration) return { error: `Unknown integration: ${name}` };
  return integration.call(method, params);
}

/**
 * Check how many integrations are available.
 */
export function countAvailableIntegrations(): { total: number; available: number } {
  let available = 0;
  for (const integration of integrations.values()) {
    if (integration.available) available++;
  }
  return { total: integrations.size, available };
}
