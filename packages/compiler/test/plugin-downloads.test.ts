/** Regression tests for portable bundled Codex and Claude plugin downloads. */
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildPluginDownloads } from "../src/plugin-downloads.js";

describe("buildPluginDownloads", () => {
  it("packages local stdio plugins with native marketplaces and safe contents", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "sidecar-plugin-downloads-"));
    const codexDir = path.join(rootDir, "prepared-codex");
    const claudeDir = path.join(rootDir, "prepared-claude");
    const outDir = path.join(rootDir, "downloads");

    try {
      await writePreparedPlugins(codexDir, claudeDir);
      const result = await buildPluginDownloads({
        outDir,
        codex: {
          directory: codexDir,
          mcpServer: {
            type: "stdio",
            command: "bun",
            args: ["./bin/critic.js", "mcp"],
            cwd: ".",
          },
          policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        },
        claude: {
          directory: claudeDir,
          mcpServer: {
            type: "stdio",
            command: "bun",
            args: ["${CLAUDE_PLUGIN_ROOT}/bin/critic.js", "mcp"],
          },
        },
      });

      expect(result.slug).toBe("critic");
      await expect(readJson(path.join(
        result.codexMarketplaceDir,
        "plugins/critic/.mcp.json",
      ))).resolves.toEqual({
        mcpServers: {
          critic: {
            command: "bun",
            args: ["./bin/critic.js", "mcp"],
            cwd: ".",
          },
        },
      });
      await expect(readJson(path.join(
        result.claudeMarketplaceDir,
        "plugins/critic/.mcp.json",
      ))).resolves.toEqual({
        mcpServers: {
          critic: {
            command: "bun",
            args: ["${CLAUDE_PLUGIN_ROOT}/bin/critic.js", "mcp"],
          },
        },
      });
      await expect(readJson(path.join(
        result.codexMarketplaceDir,
        ".agents/plugins/marketplace.json",
      ))).resolves.toMatchObject({
        name: "critic",
        plugins: [
          {
            source: { source: "local", path: "./plugins/critic" },
            policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
          },
        ],
      });
      await expect(readJson(path.join(
        result.claudeMarketplaceDir,
        ".claude-plugin/marketplace.json",
      ))).resolves.toMatchObject({
        name: "critic",
        plugins: [{ source: "./plugins/critic", version: "0.1.0" }],
      });
      await expect(readFile(path.join(
        result.codexMarketplaceDir,
        "plugins/critic/bin/critic.js",
      ), "utf8")).resolves.toBe("console.log('critic');\n");
      await expect(readFile(path.join(
        result.codexMarketplaceDir,
        "plugins/critic/.env.production",
      ), "utf8")).rejects.toThrow();
      await expect(readFile(path.join(
        result.codexMarketplaceDir,
        "plugins/critic/bin/runtime-link.js",
      ), "utf8")).rejects.toThrow();
      expect((await readFile(result.codexZipPath)).readUInt32LE(0)).toBe(0x04034b50);
      expect((await readFile(result.claudeZipPath)).readUInt32LE(0)).toBe(0x04034b50);

      await expect(readJson(path.join(codexDir, ".mcp.json"))).rejects.toThrow();
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("rejects Codex MCP argv that relies on an unexpanded plugin root", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "sidecar-plugin-root-"));
    const codexDir = path.join(rootDir, "prepared-codex");
    const claudeDir = path.join(rootDir, "prepared-claude");

    try {
      await writePreparedPlugins(codexDir, claudeDir);
      await expect(buildPluginDownloads({
        outDir: path.join(rootDir, "downloads"),
        codex: {
          directory: codexDir,
          mcpServer: {
            type: "stdio",
            command: "bun",
            args: ["${PLUGIN_ROOT}/bin/critic.js", "mcp"],
          },
        },
        claude: {
          directory: claudeDir,
          mcpServer: { type: "http", url: "https://critic.run/mcp" },
        },
      })).rejects.toThrow("does not expand ${PLUGIN_ROOT}");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

async function writePreparedPlugins(codexDir: string, claudeDir: string) {
  await Promise.all([
    mkdir(path.join(codexDir, ".codex-plugin"), { recursive: true }),
    mkdir(path.join(codexDir, "bin"), { recursive: true }),
    mkdir(path.join(claudeDir, ".claude-plugin"), { recursive: true }),
  ]);
  await Promise.all([
    writeJson(path.join(codexDir, ".codex-plugin/plugin.json"), {
      name: "critic",
      version: "0.1.0",
      description: "Understand agent-written code.",
      author: { name: "Feyn" },
      interface: { displayName: "Critic", category: "Developer Tools" },
    }),
    writeJson(path.join(claudeDir, ".claude-plugin/plugin.json"), {
      name: "critic",
      version: "0.1.0",
      description: "Understand agent-written code.",
      author: { name: "Feyn" },
    }),
    writeFile(path.join(codexDir, "bin/critic.js"), "console.log('critic');\n"),
    writeFile(path.join(codexDir, ".env.production"), "SECRET=nope\n"),
  ]);
  await symlink(
    path.join(codexDir, "bin/critic.js"),
    path.join(codexDir, "bin/runtime-link.js"),
  );
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function writeJson(filePath: string, value: unknown) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
