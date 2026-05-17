/** End-to-end artifact tests for real Sidecar project builds. */
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
      expect(mcp.resources.map((resource) => resource.uri)).toEqual(["sidecar://resources/company-handbook"]);
      expect(mcp.prompts.map((prompt) => prompt.name)).toEqual(["review-expense"]);
      expect(mcp.config.pagination.pageSize).toBe(10);

      const mcpManifest = await readJson<SidecarManifest>(path.join(rootDir, "out/mcp/manifest.sidecar.json"));
      const chatgptManifest = await readJson<SidecarManifest>(path.join(rootDir, "out/chatgpt/manifest.sidecar.json"));
      const claudeManifest = await readJson<SidecarManifest>(path.join(rootDir, "out/claude/manifest.sidecar.json"));
      expect(mcpManifest.target).toBe("mcp");
      expect(chatgptManifest.target).toBe("chatgpt");
      expect(claudeManifest.target).toBe("claude");
      expect(mcpManifest.resources[0]?.descriptor).toMatchObject({
        uri: "sidecar://resources/company-handbook",
        mimeType: "text/markdown",
      });
      expect(mcpManifest.prompts[0]?.descriptor).toMatchObject({
        name: "review-expense",
        title: "Review Expense",
      });

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
        .resolves.toContain('allowed-tools: "expenses.review"');
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

  it("keeps build output inside the project root", async () => {
    const rootDir = await copySimpleFixture("sidecar-e2e-outside-root-");

    try {
      await expect(
        buildProject({ rootDir, outDir: "../outside", target: "mcp" })
      ).rejects.toThrow("inside the project root");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("sanitizes generated plugin filenames and escapes frontmatter scalars", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "sidecar-e2e-plugin-sanitize-"));

    try {
      await writeFile(
        path.join(rootDir, "package.json"),
        `${JSON.stringify({ name: "sanitize-fixture", version: "0.0.0" }, null, 2)}\n`,
      );
      await mkdir(path.join(rootDir, "commands", "danger"), { recursive: true });
      await writeFile(
        path.join(rootDir, "commands", "danger", "command.ts"),
        `import { command } from "@sidecar/anthropic";

export default command({
  name: "../release:notes",
  description: "Run release notes: still one scalar.",
  allowedTools: ["Read", "Write:notes"],
  prompt: "Summarize release notes."
});
`,
      );
      await mkdir(path.join(rootDir, "agents", "danger"), { recursive: true });
      await writeFile(
        path.join(rootDir, "agents", "danger", "agent.ts"),
        `import { agent } from "@sidecar/anthropic";

export default agent({
  name: "../review-agent",
  description: "Review agent: still one scalar.",
  tools: ["Read", "Grep"],
  prompt: "Review the current change."
});
`,
      );

      await buildProject({ rootDir, outDir: "out/mcp", target: "claude", plugins: true });

      await expect(readdir(path.join(rootDir, "out", "claude-plugin", "commands")))
        .resolves.toEqual(["_release_notes.md"]);
      await expect(readdir(path.join(rootDir, "out", "claude-plugin", "agents")))
        .resolves.toEqual(["_review-agent.md"]);
      await expect(readFile(path.join(rootDir, "out", "claude-plugin", "commands", "_release_notes.md"), "utf8"))
        .resolves.toContain('description: "Run release notes: still one scalar."');
      await expect(readFile(path.join(rootDir, "out", "claude-plugin", "commands", "_release_notes.md"), "utf8"))
        .resolves.toContain('allowed-tools: "Read, Write:notes"');
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
