/** Tests for the static component parity preview renderer. */
import { describe, expect, it } from "vitest";
import {
  injectProjectPreviewBridge,
  previewComponentNames,
  readPreviewComponentSet,
  readPreviewTargets,
  readPreviewThemes,
  renderComponentPreviewFrame,
  renderComponentPreviewHtml,
  renderProjectPreviewHtml,
  type ProjectPreviewBuild,
} from "../src/index.js";

const projectPreviewBuild: ProjectPreviewBuild = {
  target: "claude",
  outDir: "out/claude",
  manifest: {
    version: 1,
    target: "claude",
    host: "node",
    rootDir: "/tmp/sidecar-preview",
    generatedAt: "2026-05-21T00:00:00.000Z",
    config: {
      build: {},
      resources: { subscribe: false, listChanged: false },
      prompts: { listChanged: false },
      tools: { listChanged: false },
      pagination: { pageSize: 50, hasOverride: false },
      codeMode: { enabled: false, unsafe: false, render: { enabled: false, strategy: "explicit" } },
      remoteExecution: { enabled: false },
    },
    tools: [
      {
        sourceFile: "server/search/tool.ts",
        variant: "shared",
        target: "claude",
        directory: "server/search",
        id: "search",
        name: "Search",
        description: "Search project data.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            limit: { type: "integer" },
          },
        },
        widget: {
          sourceFile: "server/search/widget.tsx",
          variant: "shared",
          resourceUri: "ui://sidecar/search/widget.v1.html",
          outputFile: "widgets/search.html",
        },
        descriptor: {
          name: "search",
          title: "Search",
          description: "Search project data.",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string" },
              limit: { type: "integer" },
            },
          },
          _meta: {
            "ui/resourceUri": "ui://sidecar/search/widget.v1.html",
          },
        },
      },
    ],
    resources: [],
    resourceTemplates: [],
    prompts: [],
  },
};

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
    expect(readPreviewTargets(["node", "sidecar", "preview"])).toEqual(["mcp", "chatgpt", "claude"]);
    expect(readPreviewTargets(["node", "sidecar", "preview", "--target", "chatgpt,claude"])).toEqual(["chatgpt", "claude"]);
    expect(readPreviewThemes(undefined)).toEqual(["light"]);
    expect(readPreviewThemes("both")).toEqual(["light", "dark"]);
    expect(readPreviewThemes("light,dark")).toEqual(["light", "dark"]);
    expect(() => readPreviewComponentSet("everything")).toThrow("Unsupported component preview set");
    expect(() => readPreviewTargets(["node", "sidecar", "preview", "--target", "web"])).toThrow("Unsupported Sidecar target");
    expect(() => readPreviewThemes("sepia")).toThrow("Unsupported component preview theme");
  });
});

describe("project preview renderer", () => {
  it("renders light and dark widget frames by target", () => {
    const html = renderProjectPreviewHtml([projectPreviewBuild]);

    expect(html).toContain("Sidecar preview");
    expect(html).toContain("1 widget across 1 target");
    expect(html).toContain(">light<");
    expect(html).toContain(">dark<");
    expect(html).toContain("Claude");
    expect(html).toContain("/widget?target=claude&amp;tool=search&amp;theme=light");
    expect(html).toContain("/widget?target=claude&amp;tool=search&amp;theme=dark");
  });

  it("injects preview host data into compiled widget HTML", () => {
    const html = injectProjectPreviewBridge(
      '<!doctype html><html lang="en"><head></head><body></body></html>',
      projectPreviewBuild.manifest.tools[0]!,
      "chatgpt",
      "dark",
    );

    expect(html).toContain('data-sidecar-host="chatgpt"');
    expect(html).toContain('data-sidecar-theme="dark"');
    expect(html).toContain("window.__sidecarPreview=");
    expect(html).toContain('"tool":"search"');
    expect(html).toContain('"query":"preview"');
    expect(html).toContain('"limit":1');
  });
});
