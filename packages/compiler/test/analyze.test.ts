/** Tests for compiler discovery, schema extraction, widgets, and plugin output. */
import path from "node:path";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { analyzeProjectTools, buildProject, type SidecarToolManifestEntry } from "../src/index.js";

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
        ui: { resourceUri: widgetTool?.widget?.resourceUri },
        "openai/outputTemplate": widgetTool?.widget?.resourceUri
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
});
