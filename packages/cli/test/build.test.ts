/** Tests for CLI build host selection. */
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main, renderBuildUrlSummary, renderDevUrlSummary } from "../src/index.js";

const previousVercel = process.env.VERCEL;

afterEach(() => {
  restoreEnv("VERCEL", previousVercel);
});

describe("sidecar build", () => {
  it("renders clear build and dev URL summaries", () => {
    expect(renderBuildUrlSummary({
      host: "vercel",
      mcpPath: "/mcp",
      publicMcpUrl: "https://sidecar.example.com/mcp",
      publicUrl: "https://sidecar.example.com",
    })).toBe([
      "Sidecar URLs:",
      "  Vercel MCP route: https://<project>.vercel.app/mcp",
      "  Public MCP: https://sidecar.example.com/mcp",
      "  Public base: https://sidecar.example.com",
    ].join("\n"));

    expect(renderDevUrlSummary({
      localMcpUrl: "http://127.0.0.1:3101/mcp",
      runtimeMcpUrl: "https://example.trycloudflare.com/mcp",
      tunnelProvider: "cloudflared",
      harnessUrl: "http://127.0.0.1:3000",
    })).toContain("ChatGPT/Claude connector URL: https://example.trycloudflare.com/mcp");
  });

  it("uses build defaults from sidecar.config.ts when CLI flags are absent", async () => {
    const rootDir = await copySimpleFixture("sidecar-cli-config-build-");

    try {
      await writeFile(
        path.join(rootDir, "sidecar.config.ts"),
        `import { defineConfig } from "sidecar-ai";

export default defineConfig({
  name: "Config Build Fixture",
  version: "0.1.0",
  description: "Checks config-owned build defaults.",
  build: {
    target: "claude",
    host: "vercel",
    plugins: true,
    pluginMcpUrl: "https://config.example/mcp"
  }
});
`,
      );

      await main(["node", "sidecar", "build", "--cwd", rootDir]);

      const functionDir = path.join(rootDir, ".vercel", "output", "functions", "api", "sidecar.func");
      const manifest = JSON.parse(await readFile(path.join(functionDir, "manifest.sidecar.json"), "utf8"));
      expect(manifest).toMatchObject({
        target: "claude",
        host: "vercel",
        config: {
          build: {
            target: "claude",
            host: "vercel",
            plugins: true,
            pluginMcpUrl: "https://config.example/mcp",
          },
        },
      });
      await expect(readFile(path.join(rootDir, "out", "claude-plugin", ".mcp.json"), "utf8"))
        .resolves.toContain("https://config.example/mcp");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("emits Vercel Build Output API files automatically inside Vercel", async () => {
    const rootDir = await copySimpleFixture("sidecar-cli-vercel-build-");

    try {
      process.env.VERCEL = "1";
      await main(["node", "sidecar", "build", "--cwd", rootDir, "--plugins"]);

      const functionDir = path.join(rootDir, ".vercel", "output", "functions", "api", "sidecar.func");
      await expect(readFile(path.join(rootDir, ".vercel", "output", "config.json"), "utf8"))
        .resolves.toContain("\"dest\": \"/api/sidecar\"");
      await expect(readFile(path.join(functionDir, ".vc-config.json"), "utf8"))
        .resolves.toContain("\"runtime\": \"nodejs22.x\"");
      await expect(readFile(path.join(functionDir, "server", "index.js"), "utf8"))
        .resolves.toContain("createSidecarHttpHandler");
      await expect(readFile(path.join(rootDir, "out", "claude-plugin", ".mcp.json"), "utf8"))
        .resolves.toContain("${SIDECAR_MCP_URL}");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("embeds an explicit hosted MCP URL in both plugin downloads", async () => {
    const rootDir = await copySimpleFixture("sidecar-cli-plugin-url-");

    try {
      await main([
        "node",
        "sidecar",
        "build",
        "--cwd",
        rootDir,
        "--plugins",
        "--plugin-mcp-url",
        "https://critic.example/mcp",
      ]);

      await expect(readFile(path.join(rootDir, "out", "codex-plugin", ".mcp.json"), "utf8"))
        .resolves.toContain("https://critic.example/mcp");
      await expect(readFile(path.join(rootDir, "out", "claude-plugin", ".mcp.json"), "utf8"))
        .resolves.toContain("https://critic.example/mcp");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("rejects insecure hosted plugin endpoints", async () => {
    const rootDir = await copySimpleFixture("sidecar-cli-plugin-insecure-url-");

    try {
      await expect(main([
        "node",
        "sidecar",
        "build",
        "--cwd",
        rootDir,
        "--plugins",
        "--plugin-mcp-url",
        "http://critic.example/mcp",
      ])).rejects.toThrow("Plugin MCP URL must use HTTPS outside localhost.");
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

/** Restores a process env var after env-sensitive tests. */
function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
