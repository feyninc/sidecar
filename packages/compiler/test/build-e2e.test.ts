/** End-to-end artifact tests for real Sidecar project builds. */
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { buildProject, type SidecarManifest } from "../src/index.js";

describe("buildProject E2E artifacts", { timeout: 20_000 }, () => {
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
      expect(mcpManifest.host).toBe("node");
      expect(chatgptManifest.target).toBe("chatgpt");
      expect(chatgptManifest.host).toBe("node");
      expect(claudeManifest.target).toBe("claude");
      expect(claudeManifest.host).toBe("node");
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
      expect(claudeWidget?.resourceMeta).toMatchObject({
        ui: {
          csp: {
            resourceDomains: ["https://assets.claude.ai"],
          },
        },
      });

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
      await expect(readFile(path.join(rootDir, "out/mcp/package.json"), "utf8"))
        .resolves.toContain("\"start\": \"node server/index.js\"");
      await expect(readFile(path.join(rootDir, "out/mcp/server/index.js"), "utf8"))
        .resolves.toContain("createSidecarHttpHandler");
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

  it("emits a Vercel host artifact that exposes the same MCP handler", async () => {
    const rootDir = await copySimpleFixture("sidecar-e2e-vercel-server-");
    const port = await getFreePort();
    const mcpUrl = `http://127.0.0.1:${port}/mcp`;
    let server: ReturnType<typeof createHttpServer> | undefined;
    const previousMcpUrl = process.env.SIDECAR_MCP_URL;
    const previousDemoToken = process.env.SIDECAR_DEMO_TOKEN;

    try {
      const manifest = await buildProject({ rootDir, host: "vercel", outDir: "out/vercel", target: "mcp" });
      expect(manifest.host).toBe("vercel");

      const functionDir = path.join(rootDir, "out/vercel/functions/api/sidecar.func");
      await expect(readFile(path.join(functionDir, "server/index.js"), "utf8"))
        .resolves.toContain("createSidecarHttpHandler");
      await expect(readFile(path.join(functionDir, "index.js"), "utf8"))
        .resolves.toContain("./server/index.js");
      await expect(readFile(path.join(functionDir, ".vc-config.json"), "utf8"))
        .resolves.toContain("\"runtime\": \"nodejs22.x\"");
      await expect(readFile(path.join(rootDir, "out/vercel/config.json"), "utf8"))
        .resolves.toContain("\"dest\": \"/api/sidecar\"");

      process.env.SIDECAR_MCP_URL = mcpUrl;
      process.env.SIDECAR_DEMO_TOKEN = "secret";
      const apiModule = await import(`${pathToFileURL(path.join(functionDir, "index.js")).href}?${Date.now()}`);
      const handler = apiModule.default;
      if (typeof handler !== "function") {
        throw new Error("Generated Vercel entrypoint did not export a default handler.");
      }

      server = createHttpServer((request, response) => {
        Promise.resolve(handler(request, response)).catch((error: unknown) => {
          response.statusCode = 500;
          response.end(error instanceof Error ? error.message : String(error));
        });
      });
      await listenOnPort(server, port);

      const initialize = await postMcp(mcpUrl, "secret", {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "sidecar-test", version: "0.0.0" },
        },
      });
      expect(initialize.result.serverInfo.name).toBe("Simple Sidecar Example");
    } finally {
      restoreEnv("SIDECAR_MCP_URL", previousMcpUrl);
      restoreEnv("SIDECAR_DEMO_TOKEN", previousDemoToken);
      if (server) {
        await closeHttpServer(server);
      }
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("emits a runnable Node Streamable HTTP server", async () => {
    const rootDir = await copySimpleFixture("sidecar-e2e-runnable-server-");
    const port = await getFreePort();
    let child: ReturnType<typeof spawn> | undefined;

    try {
      const manifest = await buildProject({ rootDir, outDir: "out/mcp", target: "mcp" });
      const mcpUrl = `http://127.0.0.1:${port}/mcp`;
      const serverFile = path.join(rootDir, "out/mcp/server/index.js");
      child = spawn(process.execPath, [serverFile], {
        cwd: path.join(rootDir, "out/mcp"),
        env: {
          ...process.env,
          PORT: String(port),
          SIDECAR_HOST: "127.0.0.1",
          SIDECAR_MCP_URL: mcpUrl,
          SIDECAR_DEMO_TOKEN: "secret",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      const stderr: Buffer[] = [];
      if (!child.stderr) {
        throw new Error("Generated server process did not expose stderr.");
      }
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      await waitForHttp(`${mcpUrl.replace(/\/mcp$/, "")}/.well-known/oauth-protected-resource/mcp`, child, stderr);

      const metadata = await fetch(`${mcpUrl.replace(/\/mcp$/, "")}/.well-known/oauth-protected-resource/mcp`);
      expect(metadata.status).toBe(200);
      await expect(metadata.json()).resolves.toMatchObject({
        resource: mcpUrl,
        authorization_servers: ["https://auth.example.com"],
      });

      const initialize = await postMcp(mcpUrl, "secret", {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "sidecar-test", version: "0.0.0" },
        },
      });
      expect(initialize.result.serverInfo).toMatchObject({
        name: "Simple Sidecar Example",
        version: "0.1.0-alpha.1",
      });

      const tools = await postMcp(mcpUrl, "secret", {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      });
      expect(tools.result.tools.map((tool: { name: string }) => tool.name).sort())
        .toEqual(manifest.tools.map((tool) => tool.id).sort());

      const widgetUri = manifest.tools.find((tool) => tool.id === "add-numbers")?.widget?.resourceUri;
      const resource = await postMcp(mcpUrl, "secret", {
        jsonrpc: "2.0",
        id: 3,
        method: "resources/read",
        params: { uri: widgetUri },
      });
      expect(resource.result.contents[0].mimeType).toBe("text/html;profile=mcp-app");
      expect(resource.result.contents[0].text).toContain("SidecarWidgetRoot");
    } finally {
      if (child) {
        child.kill("SIGTERM");
      }
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
        `import { command } from "@sidecar-ai/anthropic";

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
        `import { agent } from "@sidecar-ai/anthropic";

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
  return copyExampleFixture("simple", prefix);
}

/** Copies an example app into a temporary directory so builds can mutate it. */
async function copyExampleFixture(exampleName: string, prefix: string): Promise<string> {
  const fixture = path.resolve(import.meta.dirname, "../../../examples", exampleName);
  const rootDir = await mkdtemp(path.join(tmpdir(), prefix));
  await cp(fixture, rootDir, { recursive: true });
  return rootDir;
}

/** Reads a JSON file with a typed return value. */
async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

/** Reserves an available localhost TCP port for a child process test. */
async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Expected TCP server address.")));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

/** Starts an HTTP server on localhost for generated handler tests. */
async function listenOnPort(server: ReturnType<typeof createHttpServer>, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

/** Closes a test HTTP server. */
async function closeHttpServer(server: ReturnType<typeof createHttpServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

/** Restores a process env var after in-process generated module tests. */
function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

/** Polls an HTTP URL until the generated server is accepting requests. */
async function waitForHttp(
  url: string,
  child: ReturnType<typeof spawn>,
  stderr: Buffer[],
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    if (child.exitCode !== null) {
      throw new Error(`Generated server exited early: ${Buffer.concat(stderr).toString("utf8")}`);
    }
    try {
      const response = await fetch(url);
      await response.arrayBuffer();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw new Error(`Timed out waiting for generated server: ${Buffer.concat(stderr).toString("utf8")}`);
}

/** Sends one JSON-RPC request to the generated MCP server. */
async function postMcp(url: string, token: string, body: unknown): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "accept": "application/json, text/event-stream",
      "authorization": `Bearer ${token}`,
      "content-type": "application/json",
      "mcp-protocol-version": "2025-11-25",
    },
    body: JSON.stringify(body),
  });

  expect(response.status).toBe(200);
  return response.json();
}
