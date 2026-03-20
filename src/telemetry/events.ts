/**
 * Telemetry — OpenTelemetry-based event tracking
 *
 * Replaces Claude Code's custom protobuf tengu_* events with standard OTel.
 */
import { TELEMETRY_PREFIX, VERSION } from "../core/constants.js";

export interface TelemetryEvent {
  name: string;
  timestamp: string;
  sessionId?: string;
  model?: string;
  deviceId?: string;
  properties: Record<string, unknown>;
}

let _enabled = true;
let _events: TelemetryEvent[] = [];
let _flushCallback: ((events: TelemetryEvent[]) => Promise<void>) | null = null;

export function setTelemetryEnabled(enabled: boolean): void { _enabled = enabled; }
export function isTelemetryEnabled(): boolean { return _enabled; }

export function setFlushCallback(cb: (events: TelemetryEvent[]) => Promise<void>): void {
  _flushCallback = cb;
}

export function emitEvent(name: string, properties: Record<string, unknown> = {}): void {
  if (!_enabled) return;
  _events.push({
    name: `${TELEMETRY_PREFIX}${name}`,
    timestamp: new Date().toISOString(),
    properties: { ...properties, version: VERSION },
  });
}

export async function flushEvents(): Promise<number> {
  if (_events.length === 0) return 0;
  const batch = [..._events];
  _events = [];
  if (_flushCallback) {
    try { await _flushCallback(batch); } catch { /* swallow */ }
  }
  return batch.length;
}

export function getEventCount(): number { return _events.length; }
export function clearEvents(): void { _events = []; }

// Convenience emitters
export function emitInit(props: Record<string, unknown> = {}): void { emitEvent("init", props); }
export function emitExit(props: Record<string, unknown> = {}): void { emitEvent("exit", props); }
export function emitQueryError(props: Record<string, unknown> = {}): void { emitEvent("query_error", props); }
export function emitModelFallback(props: Record<string, unknown> = {}): void { emitEvent("model_fallback_triggered", props); }
