/**
 * Markdown renderer — ANSI terminal output with syntax highlighting
 *
 * Uses marked lexer to parse markdown, then renders with ANSI styles.
 * Matches Claude Code's markdown rendering (32-ui-components.js).
 */
import { Lexer, type Token, type Tokens } from "marked";

// ── ANSI style helpers ─────────────────────────────────────────────

const ESC = "\x1b[";
const RESET = `${ESC}0m`;
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;
const ITALIC = `${ESC}3m`;
const UNDERLINE = `${ESC}4m`;
const STRIKETHROUGH = `${ESC}9m`;
const FG_CYAN = `${ESC}36m`;
const FG_YELLOW = `${ESC}33m`;
const FG_GREEN = `${ESC}32m`;
const FG_BLUE = `${ESC}34m`;
const FG_MAGENTA = `${ESC}35m`;
const FG_GRAY = `${ESC}90m`;
const BG_GRAY = `${ESC}100m`;

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
        lines.push(`${FG_GRAY}${"─".repeat(Math.min(maxWidth, 60))}${RESET}`);
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
  const prefix = token.depth <= 2 ? `${BOLD}${FG_CYAN}` : `${BOLD}${FG_BLUE}`;
  const marker = "#".repeat(token.depth);
  return `${prefix}${marker} ${renderInline(token.text)}${RESET}`;
}

// ── Code blocks ────────────────────────────────────────────────────

function renderCodeBlock(token: Tokens.Code, maxWidth: number): string[] {
  const lines: string[] = [];
  const lang = token.lang ?? "";

  // Header line
  if (lang) {
    lines.push(`${FG_GRAY}┌─ ${lang} ${"─".repeat(Math.max(0, Math.min(maxWidth, 60) - lang.length - 4))}${RESET}`);
  } else {
    lines.push(`${FG_GRAY}┌${"─".repeat(Math.min(maxWidth, 60) - 1)}${RESET}`);
  }

  // Code lines with basic syntax highlighting
  for (const line of token.text.split("\n")) {
    const highlighted = lang ? highlightSyntax(line, lang) : `${FG_GREEN}${line}${RESET}`;
    lines.push(`${FG_GRAY}│${RESET} ${highlighted}`);
  }

  // Footer line
  lines.push(`${FG_GRAY}└${"─".repeat(Math.min(maxWidth, 60) - 1)}${RESET}`);

  return lines;
}

// ── Lists ──────────────────────────────────────────────────────────

function renderList(token: Tokens.List): string[] {
  const lines: string[] = [];
  const ordered = token.ordered;

  for (let i = 0; i < token.items.length; i++) {
    const item = token.items[i];
    const marker = ordered ? `${FG_YELLOW}${i + 1}.${RESET}` : `${FG_YELLOW}•${RESET}`;
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
  return inner.split("\n").map((line) => `${FG_GRAY}│${RESET} ${DIM}${line}${RESET}`);
}

// ── Tables ─────────────────────────────────────────────────────────

function renderTable(token: Tokens.Table, maxWidth: number): string[] {
  const lines: string[] = [];

  // Calculate column widths
  const colWidths: number[] = token.header.map((h) => h.text.length);
  for (const row of token.rows) {
    for (let i = 0; i < row.length; i++) {
      colWidths[i] = Math.max(colWidths[i] ?? 0, row[i].text.length);
    }
  }

  // Cap widths to fit terminal
  const totalWidth = colWidths.reduce((a, b) => a + b, 0) + colWidths.length * 3 + 1;
  if (totalWidth > maxWidth) {
    const scale = maxWidth / totalWidth;
    for (let i = 0; i < colWidths.length; i++) {
      colWidths[i] = Math.max(3, Math.floor(colWidths[i] * scale));
    }
  }

  // Header
  const headerLine = token.header
    .map((h, i) => pad(h.text, colWidths[i]))
    .join(` ${FG_GRAY}│${RESET} `);
  lines.push(`${BOLD}${headerLine}${RESET}`);

  // Separator
  const sepLine = colWidths.map((w) => "─".repeat(w)).join(`─┼─`);
  lines.push(`${FG_GRAY}${sepLine}${RESET}`);

  // Rows
  for (const row of token.rows) {
    const rowLine = row
      .map((cell, i) => pad(cell.text, colWidths[i]))
      .join(` ${FG_GRAY}│${RESET} `);
    lines.push(rowLine);
  }

  return lines;
}

// ── Inline rendering ───────────────────────────────────────────────

function renderInline(text: string): string {
  return text
    // Bold
    .replace(/\*\*(.+?)\*\*/g, `${BOLD}$1${RESET}`)
    .replace(/__(.+?)__/g, `${BOLD}$1${RESET}`)
    // Italic
    .replace(/\*(.+?)\*/g, `${ITALIC}$1${RESET}`)
    .replace(/_(.+?)_/g, `${ITALIC}$1${RESET}`)
    // Strikethrough
    .replace(/~~(.+?)~~/g, `${STRIKETHROUGH}$1${RESET}`)
    // Inline code
    .replace(/`([^`]+)`/g, `${BG_GRAY}${FG_GREEN} $1 ${RESET}`)
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, `${UNDERLINE}${FG_BLUE}$1${RESET}${FG_GRAY} ($2)${RESET}`)
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
  const kw = keywords[lang] ?? keywords[lang.replace(/x$/, "")] ?? ts;

  let result = line;

  // Comments
  result = result.replace(/(\/\/.*$)/gm, `${FG_GRAY}$1${RESET}`);
  result = result.replace(/(#.*$)/gm, `${FG_GRAY}$1${RESET}`);

  // Strings
  result = result.replace(/("[^"]*")/g, `${FG_GREEN}$1${RESET}`);
  result = result.replace(/('[^']*')/g, `${FG_GREEN}$1${RESET}`);
  result = result.replace(/(`[^`]*`)/g, `${FG_GREEN}$1${RESET}`);

  // Keywords (word boundary)
  for (const kwd of kw) {
    result = result.replace(
      new RegExp(`\\b(${kwd})\\b`, "g"),
      `${FG_MAGENTA}$1${RESET}`,
    );
  }

  // Numbers
  result = result.replace(/\b(\d+\.?\d*)\b/g, `${FG_YELLOW}$1${RESET}`);

  return result;
}

// ── Helpers ────────────────────────────────────────────────────────

function pad(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  return text + " ".repeat(width - text.length);
}
