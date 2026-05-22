/** Tests for the local Sidecar dev harness. */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  mcpToolsToOpenAiTools,
  renderDevHarnessHtml,
  startDevHarness,
  toolResourceUri,
} from "../src/dev-harness.js";

const servers: Server[] = [];
const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all([
    ...servers.splice(0).map((server) => closeServer(server)),
    ...cleanupTasks.splice(0).map((cleanup) => cleanup()),
  ]);
});

describe("dev harness", () => {
  it("converts MCP tools to OpenAI tools without losing the MCP name mapping", () => {
    const tool = {
      name: "notion-search",
      title: "Search Notion",
      description: "Search Notion content.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
      },
      _meta: {
        "ui/resourceUri": "ui://sidecar/notion-search/widget.html",
      },
    };

    const mapped = mcpToolsToOpenAiTools([tool]);

    expect(mapped.tools[0]?.function.name).toBe("notion-search");
    expect(mapped.tools[0]?.function.parameters).toEqual(tool.inputSchema);
    expect(mapped.byOpenAiName.get("notion-search")).toBe(tool);
    expect(toolResourceUri(tool)).toBe("ui://sidecar/notion-search/widget.html");
  });

  it("streams model deltas, calls MCP tools, and emits widget-capable tool results", async () => {
    const mcp = await startFakeMcpServer();
    const openai = await startFakeOpenAiServer();
    const harness = await startDevHarness({
      rootDir: "/tmp/sidecar-dev-test",
      mcpUrl: `${mcp.url}/mcp`,
      host: "claude",
      theme: "dark",
      device: "mobile",
      target: "claude",
      port: 0,
      model: "gpt-4.1-mini",
      openAiApiKey: "test-key",
      openAiBaseUrl: `${openai.url}/v1/chat/completions`,
    });
    cleanupTasks.push(() => harness.close());

    const state = await fetchJson(`${harness.url}/__sidecar/dev/state`);
    expect(state).toMatchObject({
      host: "claude",
      theme: "dark",
      device: "mobile",
      target: "claude",
    });

    const update = await fetchJson(`${harness.url}/__sidecar/dev/state`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ host: "chatgpt", theme: "light", device: "desktop" }),
    });
    expect(update).toMatchObject({ host: "chatgpt", theme: "light", device: "desktop" });

    const renderer = await fetch(`${harness.url}/__sidecar/dev/streamdown-client.js`);
    expect(renderer.ok).toBe(true);
    expect(await renderer.text()).toContain("SidecarStreamdown");

    const response = await fetch(`${harness.url}/__sidecar/dev/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Search Notion for roadmap" }],
      }),
    });
    expect(response.ok).toBe(true);
    const text = await response.text();

    expect(text).toContain("event: tool_start");
    expect(text).toContain("\"name\":\"notion-search\"");
    expect(text).toContain("event: tool_result");
    expect(text).toContain("ui://sidecar/notion-search/widget.html");
    expect(text).toContain("event: delta");
    expect(text).toContain("Found it.");
  });

  it("waits for widget initialization before sending tool result notifications", () => {
    const html = renderDevHarnessHtml({
      host: "claude",
      theme: "dark",
      device: "desktop",
      target: "claude",
      model: "gpt-4.1-mini",
    });

    expect(html).toContain('message.method === "ui/notifications/initialized"');
    expect(html).toContain("sendFrameContext(event.source)");
    expect(html).not.toContain('queueMicrotask(() =>');
  });

  it("keeps bearer tokens behind a tested modal save flow", () => {
    const html = renderDevHarnessHtml({
      host: "claude",
      theme: "dark",
      device: "desktop",
      target: "claude",
      model: "gpt-4.1-mini",
    });

    expect(html).toContain('id="authTrigger"');
    expect(html).toContain("Set Bearer Token");
    expect(html).toContain('role="dialog"');
    expect(html).toContain("Sidecar will test this token");
    expect(html).toContain('method: "tools/list"');
    expect(html).toContain("testBearerToken(nextToken)");
    expect(html).not.toContain('<span class="status">Bearer</span>');
    expect(html).not.toContain("auth-indicator");
    expect(html).not.toContain("control-label");
    expect(html).toContain("syncSegmentedControl");
    expect(html).toContain("--active-index");
  });

  it("can seed the bearer token from the dev environment", () => {
    const html = renderDevHarnessHtml({
      host: "claude",
      theme: "dark",
      device: "desktop",
      target: "claude",
      model: "gpt-4.1-mini",
    }, {
      initialBearerToken: "test-token",
    });

    expect(html).toContain('const initialBearerToken = "test-token";');
    expect(html).toContain('let bearerToken = initialBearerToken || localStorage.getItem("sidecar.dev.bearer") || "";');
  });
});

async function startFakeMcpServer(): Promise<{ url: string; server: Server }> {
  const server = createServer(async (request, response) => {
    const body = await readJson(request);
    const method = body.method;
    if (method === "tools/list") {
      sendJson(response, {
        jsonrpc: "2.0",
        id: body.id,
        result: {
          tools: [
            {
              name: "notion-search",
              title: "Search Notion",
              description: "Search Notion content.",
              inputSchema: {
                type: "object",
                properties: {
                  query: { type: "string" },
                },
              },
              _meta: {
                "ui/resourceUri": "ui://sidecar/notion-search/widget.html",
              },
            },
          ],
        },
      });
      return;
    }
    if (method === "tools/call") {
      sendJson(response, {
        jsonrpc: "2.0",
        id: body.id,
        result: {
          structuredContent: {
            result: "Roadmap",
          },
          content: [{ type: "text", text: "Found a Notion roadmap page." }],
          _meta: {},
        },
      });
      return;
    }
    if (method === "resources/read") {
      sendJson(response, {
        jsonrpc: "2.0",
        id: body.id,
        result: {
          contents: [
            {
              uri: "ui://sidecar/notion-search/widget.html",
              mimeType: "text/html;profile=mcp-app",
              text: "<!doctype html><html><body>Widget</body></html>",
            },
          ],
        },
      });
      return;
    }
    sendJson(response, {
      jsonrpc: "2.0",
      id: body.id,
      error: { code: -32601, message: "Unsupported" },
    });
  });
  const url = await listen(server);
  servers.push(server);
  return { url, server };
}

async function startFakeOpenAiServer(): Promise<{ url: string; server: Server }> {
  let callCount = 0;
  const server = createServer(async (_request, response) => {
    callCount += 1;
    response.writeHead(200, { "content-type": "text/event-stream" });
    if (callCount === 1) {
      response.write(`data: ${JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "notion-search",
                    arguments: "{\"query\":\"roadmap\"}",
                  },
                },
              ],
            },
          },
        ],
      })}\n\n`);
      response.write("data: [DONE]\n\n");
      response.end();
      return;
    }

    response.write(`data: ${JSON.stringify({
      choices: [
        {
          delta: {
            content: "Found it.",
          },
        },
      ],
    })}\n\n`);
    response.write("data: [DONE]\n\n");
    response.end();
  });
  const url = await listen(server);
  servers.push(server);
  return { url, server };
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function readJson(request: NodeJS.ReadableStream): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response: any, body: unknown): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const response = await fetch(url, init);
  expect(response.ok).toBe(true);
  return response.json();
}
