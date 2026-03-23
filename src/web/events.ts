/**
 * Event bridge — shared EventEmitter for streaming UI state to WebSocket clients
 *
 * The Ink app emits events here, and the WebSocket server relays them.
 */
import { EventEmitter } from "events";

export interface DashboardEvent {
  type: "message" | "tool_start" | "tool_end" | "thinking" | "streaming" | "status" | "busy" | "idle";
  data: unknown;
  timestamp: number;
}

class DashboardEventBridge extends EventEmitter {
  private clients: Set<(data: string) => void> = new Set();

  emit(event: string, ...args: unknown[]): boolean {
    // Also relay to WebSocket clients
    if (event === "event") {
      const payload = JSON.stringify(args[0]);
      for (const send of this.clients) {
        try { send(payload); } catch { this.clients.delete(send); }
      }
    }
    return super.emit(event, ...args);
  }

  addClient(send: (data: string) => void): void {
    this.clients.add(send);
  }

  removeClient(send: (data: string) => void): void {
    this.clients.delete(send);
  }

  get clientCount(): number {
    return this.clients.size;
  }

  /** Emit a dashboard event */
  push(type: DashboardEvent["type"], data: unknown): void {
    this.emit("event", { type, data, timestamp: Date.now() } satisfies DashboardEvent);
  }
}

export const dashboardEvents = new DashboardEventBridge();
