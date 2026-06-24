export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 200;
export const DEFAULT_TEXT_LIMIT = 4_000;
export const MAX_TEXT_LIMIT = 30_000;

export function parseLimit(
  value: unknown,
  defaultLimit = DEFAULT_LIST_LIMIT,
  maxLimit = MAX_LIST_LIMIT,
): number {
  if (value === undefined || value === null || value === "") return defaultLimit;
  const parsed = typeof value === "number" ? value : parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultLimit;
  return Math.min(Math.floor(parsed), maxLimit);
}

export function truncateText(value: unknown, maxChars = 120): string {
  const text = String(value ?? "");
  if (maxChars <= 0 || text.length <= maxChars) return text;
  if (maxChars <= 3) return ".".repeat(maxChars);
  return text.slice(0, maxChars - 3) + "...";
}

export function compactWhitespace(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function truncateLine(value: unknown, maxChars = 120): string {
  return truncateText(compactWhitespace(value), maxChars);
}

export function sliceWithLimit<T>(items: readonly T[], limit: number): { items: T[]; hidden: number } {
  const shown = items.slice(0, limit);
  return { items: [...shown], hidden: Math.max(0, items.length - shown.length) };
}

export function compactLongText(
  value: unknown,
  maxChars = DEFAULT_TEXT_LIMIT,
  hint?: string,
): string {
  const text = String(value ?? "");
  if (text.length <= maxChars) return text;
  const suffix = hint ? ` ${hint}` : "";
  return text.slice(0, Math.max(0, maxChars)) +
    `\n\n... truncated ${text.length - maxChars} character(s).${suffix}`;
}

export function compactLongTextMiddle(
  value: unknown,
  maxChars = DEFAULT_TEXT_LIMIT,
  hint?: string,
): string {
  const text = String(value ?? "");
  if (text.length <= maxChars) return text;
  if (maxChars <= 0) return "";
  const head = Math.ceil(maxChars / 2);
  const tail = Math.floor(maxChars / 2);
  const suffix = hint ? ` ${hint}` : "";
  return text.slice(0, head) +
    `\n\n... truncated ${text.length - maxChars} character(s).${suffix} ...\n\n` +
    text.slice(text.length - tail);
}

export function compactJson(value: unknown, maxChars = DEFAULT_TEXT_LIMIT, hint?: string): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return compactLongText(text, maxChars, hint);
}

export function formatHiddenItemsHint(hidden: number, detailHint: string): string | undefined {
  if (hidden <= 0) return undefined;
  return `${hidden} more item(s) hidden. ${detailHint}`;
}
