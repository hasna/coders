/**
 * Markdown renderer — ANSI terminal output with syntax highlighting
 *
 * Uses marked lexer to parse markdown, then renders with ANSI styles.
 * Matches Claude Code's markdown rendering (32-ui-components.js).
 */
import { Lexer, type Token, type Tokens } from "marked";

// ── ANSI style helpers ─────────────────────────────────────────────
// We use specific close codes instead of a blanket \x1b[0m reset so that
// inline formatting (bold, italic, etc.) doesn't kill the parent style
// context (e.g. a heading's color).  Ink also re-encodes ANSI, so
// matching open/close pairs keeps the output well-formed.

const ESC = "\x1b[";
const RESET = `${ESC}0m`;          // full reset — only for top-level wrappers
const BOLD = `${ESC}1m`;
const BOLD_OFF = `${ESC}22m`;      // close bold / dim
const DIM = `${ESC}2m`;
const DIM_OFF = `${ESC}22m`;
const ITALIC = `${ESC}3m`;
const ITALIC_OFF = `${ESC}23m`;
const UNDERLINE = `${ESC}4m`;
const UNDERLINE_OFF = `${ESC}24m`;
const STRIKETHROUGH = `${ESC}9m`;
const STRIKE_OFF = `${ESC}29m`;
const FG_CYAN = `${ESC}36m`;
const FG_YELLOW = `${ESC}33m`;
const FG_GREEN = `${ESC}32m`;
const FG_BLUE = `${ESC}34m`;
const FG_MAGENTA = `${ESC}35m`;
const FG_GRAY = `${ESC}90m`;
const FG_DEFAULT = `${ESC}39m`;    // restore default foreground
const BG_GRAY = `${ESC}100m`;
const BG_DEFAULT = `${ESC}49m`;    // restore default background

// ── Main render function ───────────────────────────────────────────

/**
 * Render markdown text to ANSI-styled terminal output.
 */
export function renderMarkdown(markdown: string, maxWidth = 120): string {
  const lexer = new Lexer();
  const tokens = lexer.lex(markdown);
  return renderTokens(tokens, maxWidth);
}

function renderTokens(tokens: Token[], maxWidth: number): string {
  const lines: string[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case "heading":
        lines.push(renderHeading(token as Tokens.Heading));
        lines.push("");
        break;

      case "paragraph":
        lines.push(renderInline((token as Tokens.Paragraph).text));
        lines.push("");
        break;

      case "code":
        lines.push(...renderCodeBlock(token as Tokens.Code, maxWidth));
        lines.push("");
        break;

      case "list":
        lines.push(...renderList(token as Tokens.List));
        lines.push("");
        break;

      case "blockquote":
        lines.push(...renderBlockquote(token as Tokens.Blockquote));
        lines.push("");
        break;

      case "table":
        lines.push(...renderTable(token as Tokens.Table, maxWidth));
        lines.push("");
        break;

      case "hr":
        lines.push(`${FG_GRAY}${"─".repeat(Math.min(maxWidth, 60))}${FG_DEFAULT}`);
        lines.push("");
        break;

      case "space":
        lines.push("");
        break;

      case "html":
        // Strip HTML tags, render as text
        lines.push(renderInline((token as Tokens.HTML).text.replace(/<[^>]+>/g, "")));
        break;

      default:
        if ("text" in token) {
          lines.push(renderInline(String((token as { text: string }).text)));
        }
        break;
    }
  }

  return lines.join("\n");
}

// ── Headings ───────────────────────────────────────────────────────

function renderHeading(token: Tokens.Heading): string {
  const color = token.depth <= 2 ? FG_CYAN : FG_BLUE;
  const prefix = `${BOLD}${color}`;
  const marker = "#".repeat(token.depth);
  // Render inline content, then re-apply the heading style after every
  // close code so that bold-off or fg-default inside the inline text
  // doesn't kill the heading's own bold+color.
  const inner = renderInlineWithRestore(token.text, prefix);
  return `${prefix}${marker} ${inner}${RESET}`;
}

// ── Code blocks ────────────────────────────────────────────────────

function renderCodeBlock(token: Tokens.Code, maxWidth: number): string[] {
  const lines: string[] = [];
  const lang = token.lang ?? "";

  // Header line
  if (lang) {
    lines.push(`${FG_GRAY}┌─ ${lang} ${"─".repeat(Math.max(0, Math.min(maxWidth, 60) - lang.length - 4))}${FG_DEFAULT}`);
  } else {
    lines.push(`${FG_GRAY}┌${"─".repeat(Math.min(maxWidth, 60) - 1)}${FG_DEFAULT}`);
  }

  // Code lines with basic syntax highlighting
  for (const line of token.text.split("\n")) {
    const highlighted = lang ? highlightSyntax(line, lang) : `${FG_GREEN}${line}${FG_DEFAULT}`;
    lines.push(`${FG_GRAY}│${FG_DEFAULT} ${highlighted}`);
  }

  // Footer line
  lines.push(`${FG_GRAY}└${"─".repeat(Math.min(maxWidth, 60) - 1)}${FG_DEFAULT}`);

  return lines;
}

// ── Lists ──────────────────────────────────────────────────────────

function renderList(token: Tokens.List): string[] {
  const lines: string[] = [];
  const ordered = token.ordered;

  for (let i = 0; i < token.items.length; i++) {
    const item = token.items[i];
    const marker = ordered ? `${FG_YELLOW}${i + 1}.${FG_DEFAULT}` : `${FG_YELLOW}•${FG_DEFAULT}`;
    const text = renderInline(item.text);
    lines.push(`  ${marker} ${text}`);

    // Nested lists
    if (item.tokens) {
      for (const subToken of item.tokens) {
        if (subToken.type === "list") {
          const subLines = renderList(subToken as Tokens.List);
          lines.push(...subLines.map((l) => `    ${l}`));
        }
      }
    }
  }

  return lines;
}

// ── Blockquotes ────────────────────────────────────────────────────

function renderBlockquote(token: Tokens.Blockquote): string[] {
  const inner = renderTokens(token.tokens, 100);
  return inner.split("\n").map((line) => `${FG_GRAY}│${FG_DEFAULT} ${DIM}${line}${DIM_OFF}`);
}

// ── Tables ─────────────────────────────────────────────────────────

function renderTable(token: Tokens.Table, maxWidth: number): string[] {
  const lines: string[] = [];

  // Strip inline markdown to get raw text length for column sizing
  const stripMd = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // Calculate column widths from raw text (no ANSI)
  const colWidths: number[] = token.header.map((h) => stripMd(h.text).length);
  for (const row of token.rows) {
    for (let i = 0; i < row.length; i++) {
      colWidths[i] = Math.max(colWidths[i] ?? 0, stripMd(row[i].text).length);
    }
  }

  // Cap widths to fit terminal — leave room for separators
  const overhead = colWidths.length * 3 + 1;
  const maxTable = maxWidth - 4; // 2 margin each side
  const totalWidth = colWidths.reduce((a, b) => a + b, 0) + overhead;
  if (totalWidth > maxTable) {
    const available = maxTable - overhead;
    const total = colWidths.reduce((a, b) => a + b, 0);
    for (let i = 0; i < colWidths.length; i++) {
      colWidths[i] = Math.max(4, Math.floor((colWidths[i] / total) * available));
    }
  }

  // Header — render inline markdown, then pad
  const headerLine = token.header
    .map((h, i) => padRendered(renderInline(h.text), stripMd(h.text), colWidths[i]))
    .join(` ${FG_GRAY}│${FG_DEFAULT} `);
  lines.push(`${BOLD}${headerLine}${BOLD_OFF}`);

  // Separator
  const sepLine = colWidths.map((w) => "─".repeat(w)).join(`─┼─`);
  lines.push(`${FG_GRAY}${sepLine}${FG_DEFAULT}`);

  // Rows — render inline markdown in each cell
  for (const row of token.rows) {
    const rowLine = row
      .map((cell, i) => padRendered(renderInline(cell.text), stripMd(cell.text), colWidths[i]))
      .join(` ${FG_GRAY}│${FG_DEFAULT} `);
    lines.push(rowLine);
  }

  return lines;
}

/** Pad an ANSI-rendered string based on its visible (plain) length */
function padRendered(rendered: string, plain: string, width: number): string {
  if (plain.length >= width) {
    // Truncate plain text — don't re-render through inline formatting to avoid ANSI corruption
    return plain.slice(0, width - 1) + "…";
  }
  return rendered + " ".repeat(width - plain.length);
}

// ── Inline rendering ───────────────────────────────────────────────

function renderInline(text: string): string {
  return renderInlineWithRestore(text, "");
}

/**
 * Render inline markdown with ANSI styles.
 * After each close code, re-applies `restore` so that the parent
 * context (e.g. a heading's bold+cyan) is not lost.
 */
function renderInlineWithRestore(text: string, restore: string): string {
  // Use specific close codes so inline formatting does not reset
  // the parent context (heading color, blockquote dim, etc.).
  return text
    // Bold — close with BOLD_OFF, then re-apply parent style
    .replace(/\*\*(.+?)\*\*/g, `${BOLD}$1${BOLD_OFF}${restore}`)
    .replace(/__(.+?)__/g, `${BOLD}$1${BOLD_OFF}${restore}`)
    // Italic — require word boundary to avoid matching snake_case_identifiers
    .replace(/\*(.+?)\*/g, `${ITALIC}$1${ITALIC_OFF}${restore}`)
    .replace(/(?<!\w)_([^_\s][^_]*?)_(?!\w)/g, `${ITALIC}$1${ITALIC_OFF}${restore}`)
    // Strikethrough
    .replace(/~~(.+?)~~/g, `${STRIKETHROUGH}$1${STRIKE_OFF}${restore}`)
    // Inline code — needs fg + bg close, then restore parent
    .replace(/`([^`]+)`/g, `${BG_GRAY}${FG_GREEN} $1 ${FG_DEFAULT}${BG_DEFAULT}${restore}`)
    // Links — underline + color close, then gray URL + fg close, restore parent
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, `${UNDERLINE}${FG_BLUE}$1${UNDERLINE_OFF}${FG_DEFAULT}${FG_GRAY} ($2)${FG_DEFAULT}${restore}`)
    // HTML entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

// ── Basic syntax highlighting ──────────────────────────────────────

function highlightSyntax(line: string, lang: string): string {
  // Keywords for common languages
  const keywords: Record<string, string[]> = {
    typescript: ["import", "export", "from", "const", "let", "var", "function", "class", "interface", "type", "return", "if", "else", "for", "while", "async", "await", "new", "this", "extends", "implements"],
    javascript: ["import", "export", "from", "const", "let", "var", "function", "class", "return", "if", "else", "for", "while", "async", "await", "new", "this"],
    python: ["import", "from", "def", "class", "return", "if", "elif", "else", "for", "while", "with", "as", "try", "except", "finally", "raise", "yield", "async", "await", "self"],
    rust: ["fn", "let", "mut", "pub", "struct", "enum", "impl", "trait", "use", "mod", "return", "if", "else", "for", "while", "match", "self", "super", "crate"],
    go: ["func", "var", "const", "type", "struct", "interface", "return", "if", "else", "for", "range", "switch", "case", "package", "import", "defer", "go", "chan"],
  };

  const ts = keywords.typescript ?? [];
  const kw = new Set(keywords[lang] ?? keywords[lang.replace(/x$/, "")] ?? ts);

  // Tokenize first to avoid double-highlighting. Each token gets one color.
  // Priority: comments > strings > keywords > numbers > plain
  const tokens: Array<{ text: string; color: string }> = [];
  let remaining = line;

  // Extract comment (everything after // or #)
  const commentMatch = remaining.match(/^(.*?)(\/\/.*|#.*)$/);
  let commentPart = "";
  if (commentMatch) {
    remaining = commentMatch[1];
    commentPart = commentMatch[2];
  }

  // Tokenize remaining by strings, keywords, numbers
  const tokenRegex = /("[^"]*"|'[^']*'|`[^`]*`|\b\d+\.?\d*\b|\b\w+\b)/g;
  let lastIdx = 0;
  let match;
  while ((match = tokenRegex.exec(remaining)) !== null) {
    if (match.index > lastIdx) tokens.push({ text: remaining.slice(lastIdx, match.index), color: "" });
    const t = match[1];
    if (t.startsWith('"') || t.startsWith("'") || t.startsWith("`")) {
      tokens.push({ text: t, color: FG_GREEN });
    } else if (kw.has(t)) {
      tokens.push({ text: t, color: FG_MAGENTA });
    } else if (/^\d/.test(t)) {
      tokens.push({ text: t, color: FG_YELLOW });
    } else {
      tokens.push({ text: t, color: "" });
    }
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < remaining.length) tokens.push({ text: remaining.slice(lastIdx), color: "" });
  if (commentPart) tokens.push({ text: commentPart, color: FG_GRAY });

  let result = tokens.map(t => t.color ? `${t.color}${t.text}${FG_DEFAULT}` : t.text).join("");

  return result;
}

// ── Helpers ────────────────────────────────────────────────────────

