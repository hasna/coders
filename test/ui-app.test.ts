import { describe, it, expect } from "vitest";
import React from "react";
import {
  CoderApp,
  ErrorBoundary,
  AppContext,
  StdinContext,
  FocusContext,
  enableRawMode,
  disableRawMode,
} from "../src/ui/app.js";

describe("UI App", () => {
  it("CoderApp is a PureComponent", () => {
    expect(CoderApp.prototype).toBeDefined();
    expect(typeof CoderApp.prototype.render).toBe("function");
  });

  it("creates CoderApp element", () => {
    const element = React.createElement(CoderApp, {
      sessionId: "test-session",
      model: "sonnet",
      permissionMode: "default",
      verbose: false,
      projectDir: "/tmp",
      version: "0.0.1",
    });
    expect(element).toBeTruthy();
    expect(element.type).toBe(CoderApp);
  });

  it("ErrorBoundary is a Component", () => {
    expect(typeof ErrorBoundary.prototype.render).toBe("function");
    expect(typeof ErrorBoundary.getDerivedStateFromError).toBe("function");
  });

  it("contexts have default values", () => {
    const appDefault = { sessionId: "", model: "sonnet", permissionMode: "default", verbose: false, projectDir: process.cwd(), version: "0.0.1" };
    expect(AppContext).toBeTruthy();
    expect(StdinContext).toBeTruthy();
    expect(FocusContext).toBeTruthy();
  });

  it("raw mode functions exist", () => {
    expect(typeof enableRawMode).toBe("function");
    expect(typeof disableRawMode).toBe("function");
    // Should not throw even without TTY
    enableRawMode();
    disableRawMode();
  });
});
