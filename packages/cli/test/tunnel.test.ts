/** Tests for local HTTPS tunnel provider selection without network access. */
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startTunnel, tunnelInstallMessage } from "../src/tunnel.js";

const originalPath = process.env.PATH;
const basePath = "/usr/bin:/bin";

afterEach(() => {
  process.env.PATH = originalPath;
  delete process.env.SIDECAR_TUNNEL_LOG;
});

describe("startTunnel", () => {
  it("prefers cloudflared for automatic tunnels when it is installed", async () => {
    const binDir = await mkdtemp(path.join(tmpdir(), "sidecar-cloudflared-bin-"));
    const logFile = path.join(binDir, "cloudflared.log");

    try {
      await writeExecutable(
        path.join(binDir, "cloudflared"),
        `#!/bin/sh
echo "$0 $@" > "$SIDECAR_TUNNEL_LOG"
echo "https://cloudflared-test.trycloudflare.com"
while true; do sleep 1; done
`,
      );
      process.env.PATH = `${binDir}:${basePath}`;
      process.env.SIDECAR_TUNNEL_LOG = logFile;

      const tunnel = await startTunnel({
        provider: "auto",
        port: 4567,
        path: "/mcp",
        timeoutMs: 1_000,
      });
      tunnel.close();

      expect(tunnel).toMatchObject({
        provider: "cloudflared",
        publicUrl: "https://cloudflared-test.trycloudflare.com",
        mcpUrl: "https://cloudflared-test.trycloudflare.com/mcp",
      });
      await expect(readFile(logFile, "utf8"))
        .resolves.toContain("tunnel --url http://127.0.0.1:4567 --no-autoupdate");
    } finally {
      await rm(binDir, { recursive: true, force: true });
    }
  });

  it("uses npx wrangler when explicitly requested", async () => {
    const binDir = await mkdtemp(path.join(tmpdir(), "sidecar-wrangler-bin-"));
    const logFile = path.join(binDir, "npx.log");

    try {
      await writeExecutable(
        path.join(binDir, "npx"),
        `#!/bin/sh
echo "$0 $@" > "$SIDECAR_TUNNEL_LOG"
echo "https://wrangler-test.trycloudflare.com"
while true; do sleep 1; done
`,
      );
      process.env.PATH = `${binDir}:${basePath}`;
      process.env.SIDECAR_TUNNEL_LOG = logFile;

      const tunnel = await startTunnel({
        provider: "wrangler",
        port: 5678,
        path: "mcp",
        timeoutMs: 1_000,
      });
      tunnel.close();

      expect(tunnel).toMatchObject({
        provider: "wrangler",
        publicUrl: "https://wrangler-test.trycloudflare.com",
        mcpUrl: "https://wrangler-test.trycloudflare.com/mcp",
      });
      await expect(readFile(logFile, "utf8"))
        .resolves.toContain("--yes wrangler tunnel quick-start http://127.0.0.1:5678");
    } finally {
      await rm(binDir, { recursive: true, force: true });
    }
  });

  it("gives actionable guidance when no non-interactive tunnel provider is available", async () => {
    const binDir = await mkdtemp(path.join(tmpdir(), "sidecar-empty-bin-"));

    try {
      process.env.PATH = `${binDir}:${basePath}`;

      await expect(startTunnel({
        provider: "auto",
        port: 6789,
        timeoutMs: 1_000,
      })).rejects.toThrow("cloudflared was not found on PATH");
      expect(tunnelInstallMessage("auto")).toContain("brew install cloudflared");
    } finally {
      await rm(binDir, { recursive: true, force: true });
    }
  });
});

/** Writes an executable shell script fixture. */
async function writeExecutable(filePath: string, contents: string): Promise<void> {
  await writeFile(filePath, contents);
  await chmod(filePath, 0o755);
}
