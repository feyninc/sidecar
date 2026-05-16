/** Tests for compiler discovery, schema extraction, widgets, and plugin output. */
import path from "node:path";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { analyzeProjectTools, buildProject, collectProjectDiagnostics, type SidecarToolManifestEntry } from "../src/index.js";

describe("analyzeProjectTools", () => {
  it("discovers reserved tool files and generates schemas", async () => {
    const rootDir = path.resolve(import.meta.dirname, "../../../examples/simple");
    const tools = await analyzeProjectTools(rootDir);

    expect(tools.map((entry: SidecarToolManifestEntry) => entry.id).sort()).toEqual(["add_numbers", "expenses.review"]);

    const add = tools.find((entry: SidecarToolManifestEntry) => entry.id === "add_numbers");
    expect(add?.inputSchema).toMatchObject({
      type: "object",
      properties: {
        a: { type: "number", description: "First number to add." },
        b: { type: "number", description: "Second number to add." }
      },
      required: ["a", "b"],
      additionalProperties: false
    });

    expect(add?.outputSchema).toMatchObject({
      type: "object",
      properties: {
        sum: { type: "number", description: "Sum of the two input numbers." }
      },
      required: ["sum"],
      additionalProperties: false
    });
  });

  it("builds widget resources, generated clients, and plugin packages", async () => {
    const fixture = path.resolve(import.meta.dirname, "../../../examples/simple");
    const rootDir = await mkdtemp(path.join(tmpdir(), "sidecar-simple-"));

    try {
      await cp(fixture, rootDir, { recursive: true });
      const manifest = await buildProject({ rootDir, outDir: "out/mcp", plugins: true });
      const widgetTool = manifest.tools.find((entry: SidecarToolManifestEntry) => entry.id === "add_numbers");

      expect(widgetTool?.widget?.resourceUri).toMatch(/^ui:\/\/add_numbers\/widget\.[a-f0-9]{12}\.html$/);
      expect(widgetTool?.descriptor._meta).toMatchObject({
        ui: {
          resourceUri: widgetTool?.widget?.resourceUri,
          csp: {
            connectDomains: [],
            resourceDomains: []
          }
        },
        "openai/outputTemplate": widgetTool?.widget?.resourceUri,
        "openai/widgetCSP": {
          connect_domains: [],
          resource_domains: []
        }
      });

      const reviewTool = manifest.tools.find((entry: SidecarToolManifestEntry) => entry.id === "expenses.review");
      expect(reviewTool?.descriptor._meta).toMatchObject({
        "openai/toolInvocation/invoking": "Reviewing expense report",
        "openai/toolInvocation/invoked": "Expense report reviewed"
      });

      await expect(readFile(path.join(rootDir, ".sidecar/generated/tools.ts"), "utf8")).resolves.toContain("createToolClient");
      await expect(readFile(path.join(rootDir, "out/codex-plugin/.codex-plugin/plugin.json"), "utf8")).resolves.toContain("simple-sidecar-example");
      await expect(readFile(path.join(rootDir, "out/claude-plugin/.claude-plugin/plugin.json"), "utf8")).resolves.toContain("available");
      await expect(readFile(path.join(rootDir, "out/claude-plugin/skills/review-writer/SKILL.md"), "utf8")).resolves.toContain("expense review summary");
      await expect(readFile(path.join(rootDir, "out/claude-plugin/commands/review-summary.md"), "utf8")).resolves.toContain("allowed-tools: review_expense_report");
      await expect(readFile(path.join(rootDir, "out/claude-plugin/agents/review-writer.md"), "utf8")).resolves.toContain("disallowed-tools: Write");
      await expect(readFile(path.join(rootDir, "out/claude-plugin/hooks/hooks.json"), "utf8")).resolves.toContain("SubagentStop");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("reports editor-friendly project diagnostics", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "sidecar-diagnostics-"));

    try {
      await writeFixture(
        path.join(rootDir, "server", "raw-openai", "tool.ts"),
        `import { tool } from "@sidecar/core";

type Params = {
  q: string;
};

export default tool({
  name: "Raw OpenAI",
  description: "Does a thing.",
  execute(params: Params) {
    return { q: params.q };
  }
});
`,
      );
      await writeFixture(
        path.join(rootDir, "server", "raw-openai", "widget.tsx"),
        `export default function Widget() {
  window.openai?.setWidgetState?.({});
  return null;
}
`,
      );

      const tools = await analyzeProjectTools(rootDir);
      const diagnostics = await collectProjectDiagnostics(rootDir, tools);

      expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
        expect.arrayContaining([
          "SIDECAR_METADATA_DESCRIPTION",
          "SIDECAR_TOOL_ANNOTATION",
          "SIDECAR_PARAM_DESCRIPTION",
          "SIDECAR_OPENAI_RAW_BRIDGE"
        ])
      );
      expect(diagnostics[0]).toMatchObject({
        filePath: "server/raw-openai/tool.ts",
        line: expect.any(Number),
        column: expect.any(Number)
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

/** Writes a fixture file after creating its parent directories. */
async function writeFixture(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}
