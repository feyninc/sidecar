/** Tests for the starter project scaffold. */
import { describe, expect, it } from "vitest";
import { styleTemplate } from "../src/index.js";

describe("create-sidecar-app", () => {
  it("scaffolds a normal app stylesheet with documented Sidecar override tokens", () => {
    const css = styleTemplate();

    expect(css).toContain('@import "tailwindcss";');
    expect(css).toContain('@source "./server/**/*.{ts,tsx}";');
    expect(css).toContain("Sidecar automatically loads @sidecar-ai/native/styles.css before this file.");
    expect(css).toContain("--app-font-sans");
    expect(css).toContain("--app-surface");
    expect(css).toContain("--app-text");
    expect(css).toContain("--app-muted");
    expect(css).toContain("--app-border");

    for (const token of [
      "--sc-font-sans",
      "--sc-font-mono",
      "--sc-primary",
      "--sc-primary-text",
      "--sc-radius-sm",
      "--sc-radius-md",
      "--sc-radius-lg",
      "--sc-focus",
      "--sc-control-height",
    ]) {
      expect(css).toContain(token);
    }
  });

  it("does not brand native components by default", () => {
    const css = styleTemplate();

    expect(css).not.toMatch(/^\s*--sc-primary:/m);
    expect(css).not.toMatch(/^\s*--sc-radius-md:/m);
    expect(css).not.toContain('@import "@sidecar-ai/native/styles.css";');
  });
});
