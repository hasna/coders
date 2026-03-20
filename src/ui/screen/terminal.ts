/**
 * Terminal detection and capability probing
 *
 * Detects terminal emulator, color support, and feature capabilities.
 * Matches Claude Code's terminal detection (31-ui.js).
 */

export interface TerminalCapabilities {
  name: string;
  colorDepth: 1 | 4 | 8 | 24; // 1=none, 4=16color, 8=256color, 24=truecolor
  unicode: boolean;
  hyperlinks: boolean;
  kittyProtocol: boolean;
  mouseSupport: boolean;
  sixelGraphics: boolean;
  iterm2Images: boolean;
}

/**
 * Detect terminal capabilities from environment.
 */
export function detectTerminal(): TerminalCapabilities {
  const termProgram = process.env.TERM_PROGRAM ?? "";
  const term = process.env.TERM ?? "";
  const colorTerm = process.env.COLORTERM ?? "";

  const caps: TerminalCapabilities = {
    name: detectTerminalName(termProgram, term),
    colorDepth: detectColorDepth(termProgram, colorTerm, term),
    unicode: detectUnicode(),
    hyperlinks: detectHyperlinks(termProgram),
    kittyProtocol: detectKittyProtocol(termProgram),
    mouseSupport: true, // Most modern terminals support SGR mouse
    sixelGraphics: detectSixel(termProgram),
    iterm2Images: termProgram === "iTerm.app",
  };

  return caps;
}

function detectTerminalName(termProgram: string, term: string): string {
  // Check TERM_PROGRAM first
  if (termProgram === "iTerm.app") return "iTerm2";
  if (termProgram === "WezTerm") return "WezTerm";
  if (termProgram === "vscode") return "VSCode";
  if (termProgram === "Alacritty") return "Alacritty";
  if (termProgram === "ghostty") return "Ghostty";
  if (termProgram === "contour") return "Contour";
  if (termProgram === "mintty") return "Mintty";

  // Check for Kitty
  if (process.env.KITTY_WINDOW_ID) return "Kitty";
  if (termProgram === "kitty") return "Kitty";

  // Check for foot
  if (term === "foot" || term === "foot-extra") return "foot";

  // Check for Warp
  if (process.env.WARP_IS_LOCAL_SHELL_SESSION) return "Warp";
  if (termProgram === "Warp") return "Warp";

  // Windows terminals
  if (process.env.WT_SESSION) return "Windows Terminal";
  if (process.env.ConEmuANSI || process.env.ConEmuPID) return "ConEmu";

  // VTE-based (GNOME Terminal, Tilix, etc.)
  const vteVersion = process.env.VTE_VERSION;
  if (vteVersion) {
    const ver = parseInt(vteVersion, 10);
    if (ver >= 6800) return "VTE (modern)";
    return "VTE";
  }

  // Fallback
  if (term.startsWith("xterm")) return "xterm";
  if (term.startsWith("screen")) return "screen";
  if (term.startsWith("tmux")) return "tmux";

  return "unknown";
}

function detectColorDepth(
  termProgram: string,
  colorTerm: string,
  term: string,
): 1 | 4 | 8 | 24 {
  // Truecolor detection
  if (colorTerm === "truecolor" || colorTerm === "24bit") return 24;

  // Known truecolor terminals
  const truecolorTerminals = [
    "iTerm.app", "WezTerm", "Alacritty", "kitty", "ghostty", "contour", "foot",
  ];
  if (truecolorTerminals.includes(termProgram)) return 24;
  if (process.env.KITTY_WINDOW_ID) return 24;
  if (process.env.WT_SESSION) return 24;
  if (termProgram === "vscode") return 24;

  // 256 color
  if (term.includes("256color")) return 8;
  if (colorTerm) return 8;

  // Basic 16 color
  if (term.includes("color") || term.startsWith("xterm")) return 4;

  // No color (dumb terminal)
  if (term === "dumb" || !process.stdout.isTTY) return 1;

  return 4; // default to 16 color
}

function detectUnicode(): boolean {
  const lang = process.env.LANG ?? process.env.LC_ALL ?? process.env.LC_CTYPE ?? "";
  return lang.toLowerCase().includes("utf");
}

function detectHyperlinks(termProgram: string): boolean {
  const supported = [
    "iTerm.app", "WezTerm", "Alacritty", "kitty", "ghostty", "contour", "foot", "vscode",
  ];
  if (supported.includes(termProgram)) return true;
  if (process.env.KITTY_WINDOW_ID) return true;
  if (process.env.WT_SESSION) return true;
  return false;
}

function detectKittyProtocol(termProgram: string): boolean {
  if (process.env.KITTY_WINDOW_ID) return true;
  if (termProgram === "kitty") return true;
  if (termProgram === "ghostty") return true;
  if (termProgram === "foot") return true;
  if (termProgram === "WezTerm") return true;
  return false;
}

function detectSixel(termProgram: string): boolean {
  if (termProgram === "WezTerm") return true;
  if (termProgram === "foot") return true;
  if (termProgram === "contour") return true;
  return false;
}

// ── Terminal size ──────────────────────────────────────────────────

export function getTerminalSize(): { columns: number; rows: number } {
  return {
    columns: process.stdout.columns ?? 80,
    rows: process.stdout.rows ?? 24,
  };
}

/**
 * Listen for terminal resize events.
 */
export function onResize(callback: (columns: number, rows: number) => void): () => void {
  const handler = () => {
    const { columns, rows } = getTerminalSize();
    callback(columns, rows);
  };
  process.stdout.on("resize", handler);
  return () => process.stdout.removeListener("resize", handler);
}
