/** Tests for the static component parity preview renderer. */
import { describe, expect, it } from "vitest";
import {
  previewComponentNames,
  readPreviewComponentSet,
  readPreviewThemes,
  renderComponentPreviewFrame,
  renderComponentPreviewHtml,
} from "../src/index.js";

describe("component preview renderer", () => {
  it("renders side-by-side light and dark frames for the selected host", () => {
    const html = renderComponentPreviewHtml(
      "claude",
      "native,native-claude",
      ":root { --sc-surface: transparent; }",
      ["light", "dark"],
      "all",
    );

    expect(html).toContain("light component preview");
    expect(html).toContain("dark component preview");
    expect(html).toContain("&gt;native&lt;");
    expect(html).toContain("&gt;native-claude&lt;");
    expect(html).toContain("data-sidecar-host=&quot;claude&quot;");
    expect(html).toContain("data-sidecar-theme=&quot;dark&quot;");
  });

  it("maps preview columns to native, ChatGPT, and Claude recipes", () => {
    const frame = renderComponentPreviewFrame(
      "chatgpt",
      "native,openai,anthropic",
      "",
      "dark",
      "representative",
    );

    expect(frame).toContain('data-sidecar-host="chatgpt"');
    expect(frame).toContain('data-sidecar-theme="dark"');
    expect(frame).toContain('data-sc-recipe="auto"');
    expect(frame).toContain('data-sc-recipe="chatgpt"');
    expect(frame).toContain('data-sc-recipe="claude"');
    expect(frame).toContain("Buttons");
    expect(frame).toContain("Fields");
    expect(frame).toContain("Loading");
  });

  it("tracks the full native component inventory in the all preview set", () => {
    expect(previewComponentNames("all")).toEqual(
      expect.arrayContaining([
        "Alert",
        "Avatar",
        "Button",
        "Checkbox",
        "EmptyMessage",
        "FormField",
        "Input",
        "Select",
        "SelectControl",
        "Table",
        "Textarea",
        "TextLink",
      ]),
    );
  });

  it("validates preview option parsing", () => {
    expect(readPreviewComponentSet(undefined)).toBe("representative");
    expect(readPreviewComponentSet("all")).toBe("all");
    expect(readPreviewThemes(undefined)).toEqual(["light"]);
    expect(readPreviewThemes("both")).toEqual(["light", "dark"]);
    expect(readPreviewThemes("light,dark")).toEqual(["light", "dark"]);
    expect(() => readPreviewComponentSet("everything")).toThrow("Unsupported component preview set");
    expect(() => readPreviewThemes("sepia")).toThrow("Unsupported component preview theme");
  });
});
