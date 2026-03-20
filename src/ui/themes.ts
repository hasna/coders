/**
 * Color themes for the terminal UI
 */

export interface Theme {
  name: string;
  colors: {
    primary: string;
    secondary: string;
    success: string;
    error: string;
    warning: string;
    info: string;
    muted: string;
    plan: string;
    tool: string;
    thinking: string;
  };
}

export const DEFAULT_THEME: Theme = {
  name: "default",
  colors: {
    primary: "cyan",
    secondary: "blue",
    success: "green",
    error: "red",
    warning: "yellow",
    info: "blue",
    muted: "gray",
    plan: "magenta",
    tool: "yellow",
    thinking: "gray",
  },
};

export const DARK_THEME: Theme = {
  name: "dark",
  colors: {
    primary: "#61afef",
    secondary: "#c678dd",
    success: "#98c379",
    error: "#e06c75",
    warning: "#e5c07b",
    info: "#56b6c2",
    muted: "#5c6370",
    plan: "#c678dd",
    tool: "#e5c07b",
    thinking: "#5c6370",
  },
};

export const LIGHT_THEME: Theme = {
  name: "light",
  colors: {
    primary: "#0184bc",
    secondary: "#a626a4",
    success: "#50a14f",
    error: "#e45649",
    warning: "#c18401",
    info: "#0184bc",
    muted: "#a0a1a7",
    plan: "#a626a4",
    tool: "#c18401",
    thinking: "#a0a1a7",
  },
};

const THEMES: Record<string, Theme> = {
  default: DEFAULT_THEME,
  dark: DARK_THEME,
  light: LIGHT_THEME,
};

export function getTheme(name: string): Theme {
  return THEMES[name] ?? DEFAULT_THEME;
}

export function getAvailableThemes(): string[] {
  return Object.keys(THEMES);
}
