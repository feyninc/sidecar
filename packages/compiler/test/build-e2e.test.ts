/** End-to-end artifact tests for real Sidecar project builds. */
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildProject, type SidecarManifest } from "../src/index.js";

describe("buildProject E2E artifacts", () => {
  it("builds plain MCP, ChatGPT, and Claude plugin outputs from the sample app", async () => {
    const rootDir = await copySimpleFixture("sidecar-e2e-matrix-");

    try {
      const mcp = await buildProject({ rootDir, outDir: "out/mcp", target: "mcp" });
      const chatgpt = await buildProject({ rootDir, outDir: "out/chatgpt", target: "chatgpt" });
      const claude = await buildProject({ rootDir, outDir: "out/claude", plugins: true, target: "claude" });

      expect(mcp.target).toBe("mcp");
      expect(chatgpt.target).toBe("chatgpt");
      expect(claude.target).toBe("claude");
      expect(mcp.tools.map((tool) => tool.id).sort()).toEqual(["add-numbers", "expenses.review"]);
      expect(chatgpt.tools.map((tool) => tool.id).sort()).toEqual(["add-numbers", "expenses.review"]);
      expect(claude.tools.map((tool) => tool.id).sort()).toEqual(["add-numbers", "expenses.review"]);

      const mcpManifest = await readJson<SidecarManifest>(path.join(rootDir, "out/mcp/manifest.sidecar.json"));
      const chatgptManifest = await readJson<SidecarManifest>(path.join(rootDir, "out/chatgpt/manifest.sidecar.json"));
      const claudeManifest = await readJson<SidecarManifest>(path.join(rootDir, "out/claude/manifest.sidecar.json"));
      expect(mcpManifest.target).toBe("mcp");
      expect(chatgptManifest.target).toBe("chatgpt");
      expect(claudeManifest.target).toBe("claude");

      const mcpWidget = mcpManifest.tools.find((tool) => tool.id === "add-numbers")?.widget;
      const chatgptWidget = chatgptManifest.tools.find((tool) => tool.id === "add-numbers")?.widget;
      const claudeWidget = claudeManifest.tools.find((tool) => tool.id === "add-numbers")?.widget;
      expect(mcpWidget?.resourceUri).toMatch(/^ui:\/\/add-numbers\/widget\.[a-f0-9]{12}\.html$/);
      expect(chatgptWidget?.resourceUri).toMatch(/^ui:\/\/add-numbers\/widget\.[a-f0-9]{12}\.html$/);
      expect(claudeWidget?.resourceUri).toMatch(/^ui:\/\/add-numbers\/widget\.[a-f0-9]{12}\.html$/);

      expect(mcpManifest.tools.find((tool) => tool.id === "add-numbers")?.descriptor._meta)
        .not.toHaveProperty("openai/outputTemplate");
      expect(chatgptManifest.tools.find((tool) => tool.id === "add-numbers")?.descriptor._meta)
        .toHaveProperty("openai/outputTemplate", chatgptWidget?.resourceUri);
      expect(claudeManifest.tools.find((tool) => tool.id === "add-numbers")?.descriptor._meta)
        .not.toHaveProperty("openai/outputTemplate");

      const chatgptHtml = await readFile(path.join(rootDir, "out/chatgpt", chatgptWidget?.outputFile ?? ""), "utf8");
      expect(chatgptHtml).toContain("SidecarWidgetRoot");
      expect(chatgptHtml).toContain("data-sc-component");
      expect(chatgptHtml).toContain("--app-font-sans");

      await expect(readFile(path.join(rootDir, "out/mcp/README.md"), "utf8"))
        .resolves.toContain("MCP URL");
      await expect(readFile(path.join(rootDir, "out/claude-plugin/.claude-plugin/plugin.json"), "utf8"))
        .resolves.toContain("\"name\": \"simple-sidecar-example\"");
      await expect(readFile(path.join(rootDir, "out/claude-plugin/.mcp.json"), "utf8"))
        .resolves.toContain("\"url\": \"${SIDECAR_MCP_URL}\"");
      await expect(readFile(path.join(rootDir, "out/claude-plugin/hooks/hooks.json"), "utf8"))
        .resolves.toContain("PreToolUse");
      await expect(readFile(path.join(rootDir, "out/claude-plugin/commands/review-summary.md"), "utf8"))
        .resolves.toContain("allowed-tools: expenses.review");
      await expect(readFile(path.join(rootDir, ".sidecar/generated/tools.ts"), "utf8"))
        .resolves.toContain("addNumbers");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("changes widget resource URIs when widget CSS changes", async () => {
    const rootDir = await copySimpleFixture("sidecar-e2e-cache-");

    try {
      const first = await buildProject({ rootDir, outDir: "out/first", target: "mcp" });
      const firstUri = first.tools.find((tool) => tool.id === "add-numbers")?.widget?.resourceUri;

      await writeFile(
        path.join(rootDir, "style.css"),
        `${await readFile(path.join(rootDir, "style.css"), "utf8")}\n.sidecar-cache-proof { color: rgb(1 2 3); }\n`,
      );

      const second = await buildProject({ rootDir, outDir: "out/second", target: "mcp" });
      const secondUri = second.tools.find((tool) => tool.id === "add-numbers")?.widget?.resourceUri;

      expect(firstUri).toMatch(/^ui:\/\/add-numbers\/widget\.[a-f0-9]{12}\.html$/);
      expect(secondUri).toMatch(/^ui:\/\/add-numbers\/widget\.[a-f0-9]{12}\.html$/);
      expect(secondUri).not.toBe(firstUri);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

/** Copies the sample app into a temporary directory so builds can mutate it. */
async function copySimpleFixture(prefix: string): Promise<string> {
  const fixture = path.resolve(import.meta.dirname, "../../../examples/simple");
  const rootDir = await mkdtemp(path.join(tmpdir(), prefix));
  await cp(fixture, rootDir, { recursive: true });
  return rootDir;
}

/** Reads a JSON file with a typed return value. */
async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}
