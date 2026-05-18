/** Tests for local HTTPS tunnel provider selection without network access. */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startTunnel, tunnelInstallMessage, validateTunnelEndpoint } from "../src/tunnel.js";

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

describe("validateTunnelEndpoint", () => {
  it("validates unauthenticated MCP initialize and tools/list responses", async () => {
    const server = createServer(async (request, response) => {
      const body = await readRequestBody(request);
      const payload = JSON.parse(body) as { id: number; method: string };
      if (request.method !== "POST" || request.url !== "/mcp") {
        writeJson(response, 404, { error: "not_found" });
        return;
      }
      if (payload.method === "initialize") {
        writeJson(response, 200, {
          jsonrpc: "2.0",
          id: payload.id,
          result: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            serverInfo: { name: "test", version: "0.0.0" },
          },
        });
        return;
      }
      writeJson(response, 200, {
        jsonrpc: "2.0",
        id: payload.id,
        result: { tools: [] },
      });
    });
    const origin = await listen(server);

    try {
      await expect(validateTunnelEndpoint({
        mcpUrl: `${origin}/mcp`,
        auth: false,
        requireHttps: false,
        timeoutMs: 1_000,
      })).resolves.toBeUndefined();
    } finally {
      await close(server);
    }
  });

  it("validates authenticated metadata and bearer challenges", async () => {
    const server = createServer((request, response) => {
      const origin = `http://${request.headers.host}`;
      if (request.method === "GET" && request.url === "/.well-known/oauth-protected-resource/mcp") {
        writeJson(response, 200, {
          resource: `${origin}/mcp`,
          authorization_servers: ["https://auth.example.com"],
          scopes_supported: [],
          bearer_methods_supported: ["header"],
        });
        return;
      }
      if (request.method === "POST" && request.url === "/mcp") {
        response.writeHead(401, {
          "content-type": "application/json",
          "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
        });
        response.end(JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32001,
            message: "Missing bearer token.",
          },
        }));
        return;
      }
      writeJson(response, 404, { error: "not_found" });
    });
    const origin = await listen(server);

    try {
      await expect(validateTunnelEndpoint({
        mcpUrl: `${origin}/mcp`,
        auth: true,
        requireHttps: false,
        timeoutMs: 1_000,
      })).resolves.toBeUndefined();
    } finally {
      await close(server);
    }
  });

  it("rejects auth metadata that does not match the public MCP URL", async () => {
    const server = createServer((request, response) => {
      if (request.method === "GET" && request.url === "/.well-known/oauth-protected-resource/mcp") {
        writeJson(response, 200, {
          resource: "https://different.example.com/mcp",
          authorization_servers: ["https://auth.example.com"],
          scopes_supported: [],
          bearer_methods_supported: ["header"],
        });
        return;
      }
      writeJson(response, 401, { error: "invalid_token" }, {
        "www-authenticate": "Bearer",
      });
    });
    const origin = await listen(server);

    try {
      await expect(validateTunnelEndpoint({
        mcpUrl: `${origin}/mcp`,
        auth: true,
        requireHttps: false,
        timeoutMs: 1_000,
      })).rejects.toThrow("protected-resource metadata does not match");
    } finally {
      await close(server);
    }
  });

  it("rejects HTML interstitial responses", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<!doctype html><title>warning</title>");
    });
    const origin = await listen(server);

    try {
      await expect(validateTunnelEndpoint({
        mcpUrl: `${origin}/mcp`,
        auth: false,
        requireHttps: false,
        timeoutMs: 1_000,
      })).rejects.toThrow("returned HTML instead of MCP JSON");
    } finally {
      await close(server);
    }
  });
});

/** Writes an executable shell script fixture. */
async function writeExecutable(filePath: string, contents: string): Promise<void> {
  await writeFile(filePath, contents);
  await chmod(filePath, 0o755);
}

/** Starts a test HTTP server on an ephemeral localhost port. */
function listen(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Expected TCP server address."));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

/** Closes a test HTTP server. */
function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

/** Reads the full request body from a test HTTP request. */
async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Writes a JSON test response. */
function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, {
    "content-type": "application/json",
    ...headers,
  });
  response.end(JSON.stringify(body));
}
