/** Tests for MCP JSON-RPC dispatch and auth enforcement. */
import { describe, expect, it } from "vitest";
import {
  createPromptDescriptor,
  createResourceDescriptor,
  createToolDescriptor,
  MCP_APP_RESOURCE_MIME_TYPE,
  prompt,
  resource,
  resourceResult,
  tool,
  toolResult,
  type ToolContext,
} from "sidecar-ai";
import { auth, scope, type AuthSession } from "sidecar-ai";
import { createSidecarHttpServer, createSidecarMcpServer } from "../src/index.js";

describe("SidecarMcpServer", () => {
  it("lists and calls tools", async () => {
    const add = tool({
      name: "Add Numbers",
      description: "Use this when adding two numbers.",
      execute(params: { a: number; b: number }) {
        const sum = params.a + params.b;
        return toolResult({
          structuredContent: { sum },
          content: `The sum is ${sum}.`
        });
      }
    });

    const server = createSidecarMcpServer({
      tools: [{ tool: add }],
      createContext: () => testContext()
    });

    await expect(
      server.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    ).resolves.toMatchObject({
      result: {
        tools: [{ name: "add_numbers", title: "Add Numbers" }]
      }
    });

    await expect(
      server.handle({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "add_numbers", arguments: { a: 4, b: 5 } }
      })
    ).resolves.toMatchObject({
      result: {
        structuredContent: { sum: 9 }
      }
    });
  });

  it("advertises only configured MCP capabilities", async () => {
    const server = createSidecarMcpServer({
      tools: [],
      capabilities: {
        resources: {
          subscribe: true,
          listChanged: true,
        },
        prompts: {
          listChanged: true,
        },
      },
    });

    await expect(
      server.handle({ jsonrpc: "2.0", id: 1, method: "initialize" })
    ).resolves.toMatchObject({
      result: {
        capabilities: {
          tools: {},
          resources: {
            subscribe: true,
            listChanged: true,
          },
          prompts: {
            listChanged: true,
          },
        },
      },
    });
  });

  it("responds to MCP ping requests with an empty result", async () => {
    const server = createSidecarMcpServer({ tools: [] });

    await expect(
      server.handle({ jsonrpc: "2.0", id: "ping-1", method: "ping" })
    ).resolves.toEqual({
      jsonrpc: "2.0",
      id: "ping-1",
      result: {}
    });
  });

  it("serves MCP Apps resources with standard MIME and resource metadata", async () => {
    const server = createSidecarMcpServer({
      tools: [],
      resources: [{
        uri: "ui://demo/widget.html",
        name: "Demo Widget",
        description: "Interactive demo widget.",
        mimeType: MCP_APP_RESOURCE_MIME_TYPE,
        text: "<!doctype html><html></html>",
        _meta: {
          ui: {
            prefersBorder: true,
            csp: {
              connectDomains: [],
              resourceDomains: [],
            },
          },
        },
      }],
    });

    await expect(
      server.handle({ jsonrpc: "2.0", id: 1, method: "resources/list" })
    ).resolves.toMatchObject({
      result: {
        resources: [{
          uri: "ui://demo/widget.html",
          mimeType: MCP_APP_RESOURCE_MIME_TYPE,
          _meta: {
            ui: {
              prefersBorder: true,
            },
          },
        }],
      },
    });

    await expect(
      server.handle({
        jsonrpc: "2.0",
        id: 2,
        method: "resources/read",
        params: { uri: "ui://demo/widget.html" },
      })
    ).resolves.toMatchObject({
      result: {
        contents: [{
          uri: "ui://demo/widget.html",
          mimeType: MCP_APP_RESOURCE_MIME_TYPE,
          _meta: {
            ui: {
              csp: {
                connectDomains: [],
                resourceDomains: [],
              },
            },
          },
        }],
      },
    });
  });

  it("serves authored resources and prompts", async () => {
    const handbook = resource({
      name: "Company Handbook",
      mimeType: "text/markdown",
      read() {
        return resourceResult({
          content: "# Handbook",
          mimeType: "text/markdown"
        });
      }
    });
    const reviewPrompt = prompt({
      title: "Review Expense",
      description: "Creates an expense review request.",
      args: {
        reportId: "Expense report id."
      },
      run({ reportId }: { reportId: string }) {
        return `Review ${reportId}.`;
      }
    });
    const server = createSidecarMcpServer({
      tools: [],
      resources: [{
        uri: "sidecar://resources/company-handbook",
        descriptor: createResourceDescriptor({
          uri: "sidecar://resources/company-handbook",
          name: "Company Handbook",
          mimeType: "text/markdown"
        }),
        resource: handbook
      }],
      prompts: [{
        prompt: reviewPrompt,
        descriptor: createPromptDescriptor({
          name: "review-expense",
          title: "Review Expense",
          description: "Creates an expense review request.",
          args: {
            reportId: "Expense report id."
          }
        })
      }],
      createContext: () => testContext()
    });

    await expect(
      server.handle({ jsonrpc: "2.0", id: 1, method: "resources/list" })
    ).resolves.toMatchObject({
      result: {
        resources: [{
          uri: "sidecar://resources/company-handbook",
          name: "Company Handbook",
        }],
      },
    });
    await expect(
      server.handle({
        jsonrpc: "2.0",
        id: 2,
        method: "resources/read",
        params: { uri: "sidecar://resources/company-handbook" },
      })
    ).resolves.toMatchObject({
      result: {
        contents: [{
          uri: "sidecar://resources/company-handbook",
          text: "# Handbook",
        }],
      },
    });
    await expect(
      server.handle({ jsonrpc: "2.0", id: 3, method: "prompts/list" })
    ).resolves.toMatchObject({
      result: {
        prompts: [{
          name: "review-expense",
          title: "Review Expense",
        }],
      },
    });
    await expect(
      server.handle({
        jsonrpc: "2.0",
        id: 4,
        method: "prompts/get",
        params: { name: "review-expense", arguments: { reportId: "exp_123" } },
      })
    ).resolves.toMatchObject({
      result: {
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: "Review exp_123.",
          },
        }],
      },
    });
  });

  it("gates resource subscriptions on the server-level capability", async () => {
    const disabled = createSidecarMcpServer({
      tools: [],
      resources: [{
        uri: "sidecar://resources/demo",
        name: "Demo",
        text: "demo",
      }],
    });
    const enabled = createSidecarMcpServer({
      tools: [],
      resources: [{
        uri: "sidecar://resources/demo",
        name: "Demo",
        text: "demo",
      }],
      capabilities: {
        resources: {
          subscribe: true,
        },
      },
    });

    await expect(
      disabled.handle({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/subscribe",
        params: { uri: "sidecar://resources/demo" },
      })
    ).resolves.toMatchObject({
      error: {
        code: -32601,
      },
    });
    await expect(
      enabled.handle({
        jsonrpc: "2.0",
        id: 2,
        method: "resources/subscribe",
        params: { uri: "sidecar://resources/demo" },
      })
    ).resolves.toMatchObject({
      result: {},
    });
  });


  it("paginates the four MCP list operations with opaque cursors", async () => {
    const tools = Array.from({ length: 3 }, (_value, index) =>
      tool({
        name: `Tool ${index + 1}`,
        description: "Use this when testing pagination.",
        execute() {
          return toolResult({
            structuredContent: { index },
            content: String(index)
          });
        }
      })
    );
    const resources = Array.from({ length: 3 }, (_value, index) => ({
      uri: `sidecar://resources/item-${index + 1}`,
      name: `Item ${index + 1}`,
      mimeType: "text/plain",
      text: `item ${index + 1}`
    }));
    const prompts = Array.from({ length: 3 }, (_value, index) => ({
      prompt: prompt({
        title: `Prompt ${index + 1}`,
        run() {
          return `Prompt ${index + 1}`;
        }
      }),
      descriptor: createPromptDescriptor({
        name: `prompt-${index + 1}`,
        title: `Prompt ${index + 1}`
      })
    }));
    const server = createSidecarMcpServer({
      tools: tools.map((entry) => ({ tool: entry })),
      resources,
      resourceTemplates: [
        { descriptor: { uriTemplate: "sidecar://resources/{id}", name: "Dynamic Resource" } },
        { descriptor: { uriTemplate: "sidecar://reports/{id}", name: "Dynamic Report" } },
        { descriptor: { uriTemplate: "sidecar://files/{id}", name: "Dynamic File" } },
      ],
      prompts,
      pagination: {
        pageSize: 2,
      },
    });

    const toolsFirst = await server.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(toolsFirst).toMatchObject({
      result: {
        tools: [{ name: "tool_1" }, { name: "tool_2" }],
        nextCursor: expect.any(String),
      },
    });
    const toolsCursor = (toolsFirst as { result: { nextCursor: string } }).result.nextCursor;
    await expect(
      server.handle({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: { cursor: toolsCursor },
      })
    ).resolves.toMatchObject({
      result: {
        tools: [{ name: "tool_3" }],
      },
    });

    await expect(
      server.handle({ jsonrpc: "2.0", id: 3, method: "resources/list" })
    ).resolves.toMatchObject({
      result: {
        resources: [
          { uri: "sidecar://resources/item-1" },
          { uri: "sidecar://resources/item-2" },
        ],
        nextCursor: expect.any(String),
      },
    });
    await expect(
      server.handle({ jsonrpc: "2.0", id: 4, method: "resources/templates/list" })
    ).resolves.toMatchObject({
      result: {
        resourceTemplates: [
          { uriTemplate: "sidecar://resources/{id}" },
          { uriTemplate: "sidecar://reports/{id}" },
        ],
        nextCursor: expect.any(String),
      },
    });
    await expect(
      server.handle({ jsonrpc: "2.0", id: 5, method: "prompts/list" })
    ).resolves.toMatchObject({
      result: {
        prompts: [
          { name: "prompt-1" },
          { name: "prompt-2" },
        ],
        nextCursor: expect.any(String),
      },
    });
    await expect(
      server.handle({
        jsonrpc: "2.0",
        id: 6,
        method: "tools/list",
        params: { cursor: "not-a-valid-cursor" },
      })
    ).resolves.toMatchObject({
      error: {
        code: -32602,
      },
    });
  });

  it("supports global and operation-specific pagination overrides", async () => {
    const server = createSidecarMcpServer({
      tools: [
        { tool: tool({ name: "Hidden", description: "Use this when hidden.", execute: () => toolResult({ structuredContent: {}, content: "hidden" }) }) },
        { tool: tool({ name: "Visible", description: "Use this when visible.", execute: () => toolResult({ structuredContent: {}, content: "visible" }) }) },
      ],
      prompts: [
        {
          prompt: prompt({ title: "Only Prompt", run: () => "Only prompt." }),
          descriptor: { name: "only-prompt", title: "Only Prompt" }
        }
      ],
      pagination: {
        pageSize: 10,
        override: {
          default({ items }) {
            return { items: items.slice(0, 1) };
          },
          toolsList({ items }) {
            return { items: items.slice(1) };
          }
        }
      }
    });

    await expect(
      server.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    ).resolves.toMatchObject({
      result: {
        tools: [{ name: "visible" }],
      }
    });
    await expect(
      server.handle({ jsonrpc: "2.0", id: 2, method: "prompts/list" })
    ).resolves.toMatchObject({
      result: {
        prompts: [{ name: "only-prompt" }],
      }
    });
  });

  it("honors notifications/cancelled by aborting an active tool request", async () => {
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const longRunning = tool({
      name: "Long Running",
      description: "Use this when testing cancellation.",
      execute(_params: {}, ctx) {
        markStarted();
        return new Promise<never>((_resolve, reject) => {
          ctx.request.signal.addEventListener("abort", () => {
            reject(ctx.request.signal.reason);
          }, { once: true });
        });
      }
    });
    const server = createSidecarMcpServer({
      tools: [{ tool: longRunning }],
      createContext: () => testContext()
    });

    const call = server.handle({
      jsonrpc: "2.0",
      id: 44,
      method: "tools/call",
      params: { name: "long_running", arguments: {} }
    });
    await started;
    await expect(
      server.handle({
        jsonrpc: "2.0",
        method: "notifications/cancelled",
        params: { requestId: 44, reason: "test cancellation" }
      })
    ).resolves.toBeUndefined();
    await expect(call).resolves.toBeUndefined();
  });

  it("enforces tool-local auth policies", async () => {
    type DemoSession = AuthSession<Record<string, unknown>, { orgId: string }>;
    const appAuth = auth({
      resource: "https://api.example.com/mcp",
      authorizationServers: ["https://auth.example.com"],
      scopes: {
        expensesRead: scope("expenses.read", "Read expenses.")
      },
      async session(request): Promise<DemoSession | null> {
        if (request.bearerToken() !== "abc") {
          return null;
        }

        return {
          userId: "user_123",
          scopes: ["expenses.read"],
          orgId: "org_123"
        };
      }
    });

    const review = tool({
      name: "Review Expense",
      description: "Use this when reviewing one expense report.",
      auth: {
        scopes: [appAuth.scopes.expensesRead]
      },
      execute(_params: {}, ctx) {
        return toolResult({
          structuredContent: { orgId: ctx.auth.orgId },
          content: `Using organization ${ctx.auth.orgId}.`
        });
      }
    });
    const publicSummary = tool({
      name: "Public Summary",
      description: "Use this when returning public summary information.",
      execute() {
        return toolResult({
          structuredContent: { public: true },
          content: "Public summary is available."
        });
      }
    });
    const account = tool({
      name: "Account Info",
      description: "Use this when returning authenticated account information.",
      auth: {
        authenticated: true
      },
      execute(_params: {}, ctx: ToolContext<DemoSession>) {
        return toolResult({
          structuredContent: { orgId: ctx.auth.orgId },
          content: `Using organization ${ctx.auth.orgId}.`
        });
      }
    });

    const server = createSidecarMcpServer({
      auth: appAuth,
      tools: [{ tool: review }, { tool: publicSummary }, { tool: account }],
      createContext: () => testContext()
    });

    await expect(
      server.handle(
        {
          jsonrpc: "2.0",
          id: 0,
          method: "tools/call",
          params: { name: "public_summary", arguments: {} }
        },
        {
          request: new Request("https://api.example.com/mcp", {
            headers: { authorization: "Bearer abc" }
          })
        }
      )
    ).resolves.toMatchObject({
      result: {
        structuredContent: { public: true }
      }
    });

    await expect(
      server.handle({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "review_expense", arguments: {} }
      })
    ).resolves.toMatchObject({
      error: {
        code: -32001,
        data: { status: 401 }
      }
    });

    await expect(
      server.handle(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "review_expense", arguments: {} }
        },
        {
          request: new Request("https://api.example.com/mcp", {
            headers: { authorization: "Bearer abc" }
          })
        }
      )
    ).resolves.toMatchObject({
      result: {
        structuredContent: { orgId: "org_123" }
      }
    });

    await expect(
      server.handle(
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "account_info", arguments: {} }
        },
        {
          request: new Request("https://api.example.com/mcp", {
            headers: { authorization: "Bearer abc" }
          })
        }
      )
    ).resolves.toMatchObject({
      result: {
        structuredContent: { orgId: "org_123" }
      }
    });
  });

  it("maps JSON-RPC auth errors to HTTP auth responses", async () => {
    const appAuth = auth({
      resource: "http://127.0.0.1:0/mcp",
      authorizationServers: ["https://auth.example.com"],
      scopes: {
        expensesRead: scope("expenses.read", "Read expenses.")
      },
      session() {
        return null;
      }
    });
    const review = tool({
      name: "Review Expense",
      description: "Use this when reviewing one expense report.",
      auth: {
        scopes: [appAuth.scopes.expensesRead]
      },
      execute() {
        return toolResult({
          structuredContent: { ok: true },
          content: "Review complete."
        });
      }
    });
    const http = createSidecarHttpServer({
      auth: appAuth,
      tools: [{ tool: review }]
    });
    const baseUrl = await listen(http);

    try {
      const response = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "review_expense", arguments: {} }
        })
      });

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain("resource_metadata=");
      await expect(response.json()).resolves.toMatchObject({
        error: {
          code: -32001
        }
      });
    } finally {
      await close(http);
    }
  });

  it("protects the whole MCP endpoint when auth is configured", async () => {
    const appAuth = auth({
      resource: "http://127.0.0.1:0/mcp",
      authorizationServers: ["https://auth.example.com"],
      scopes: {},
      session() {
        return null;
      }
    });
    const http = createSidecarHttpServer({
      auth: appAuth,
      tools: []
    });
    const baseUrl = await listen(http);

    try {
      const response = await postRpc(baseUrl, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list"
      });

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain("resource_metadata=");
    } finally {
      await close(http);
    }
  });

  it("rejects unsupported Streamable HTTP request shapes before dispatch", async () => {
    const http = createSidecarHttpServer({
      maxBodyBytes: 128,
      tools: []
    });
    const baseUrl = await listen(http);

    try {
      await expect(
        postRpc(baseUrl, [{ jsonrpc: "2.0", id: 1, method: "tools/list" }])
          .then((response) => response.status)
      ).resolves.toBe(400);

      await expect(
        postRpc(baseUrl, { jsonrpc: "2.0", id: 1, result: {} })
          .then((response) => response.status)
      ).resolves.toBe(202);

      await expect(
        fetch(`${baseUrl}/mcp`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json"
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })
        }).then((response) => response.status)
      ).resolves.toBe(406);

      await expect(
        fetch(`${baseUrl}/mcp`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            "mcp-protocol-version": "1900-01-01"
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" })
        }).then((response) => response.status)
      ).resolves.toBe(400);

      await expect(
        fetch(`${baseUrl}/mcp`, {
          method: "GET",
          headers: {
            accept: "application/json"
          }
        }).then((response) => response.status)
      ).resolves.toBe(406);

      await expect(
        fetch(`${baseUrl}/mcp`, {
          method: "DELETE"
        }).then((response) => response.status)
      ).resolves.toBe(405);

      await expect(
        fetch(`${baseUrl}/mcp`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream"
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 4,
            method: "tools/call",
            params: { name: "missing", arguments: { value: "x".repeat(1_000) } }
          })
        }).then((response) => response.status)
      ).resolves.toBe(413);
    } finally {
      await close(http);
    }
  });

  it("opens a Streamable HTTP GET SSE stream for server notifications", async () => {
    const announce = tool({
      name: "Announce Change",
      description: "Use this when testing list change notifications.",
      async execute(_params: {}, ctx) {
        await ctx.notify.toolsChanged();
        return toolResult({
          structuredContent: { ok: true },
          content: "Announced."
        });
      }
    });
    const http = createSidecarHttpServer({
      tools: [{ tool: announce }],
      capabilities: {
        tools: {
          listChanged: true
        }
      }
    });
    const baseUrl = await listen(http);
    const abort = new AbortController();

    try {
      const sseResponse = await fetch(`${baseUrl}/mcp`, {
        headers: {
          accept: "text/event-stream"
        },
        signal: abort.signal
      });
      expect(sseResponse.status).toBe(200);
      expect(sseResponse.headers.get("content-type")).toContain("text/event-stream");

      const notification = readSseMessage(sseResponse, (message) =>
        message.method === "notifications/tools/list_changed"
      );
      await postRpc(baseUrl, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "announce_change", arguments: {} }
      });

      await expect(notification).resolves.toMatchObject({
        jsonrpc: "2.0",
        method: "notifications/tools/list_changed"
      });
    } finally {
      abort.abort();
      await close(http);
    }
  });

  it("emits resource update notifications after resource subscription", async () => {
    const refresh = tool({
      name: "Refresh Resource",
      description: "Use this when testing subscribed resource updates.",
      async execute(_params: {}, ctx) {
        await ctx.notify.resourceUpdated("sidecar://resources/demo");
        return toolResult({
          structuredContent: { ok: true },
          content: "Resource refreshed."
        });
      }
    });
    const http = createSidecarHttpServer({
      tools: [{ tool: refresh }],
      resources: [{
        uri: "sidecar://resources/demo",
        name: "Demo",
        text: "demo"
      }],
      capabilities: {
        resources: {
          subscribe: true
        }
      }
    });
    const baseUrl = await listen(http);
    const abort = new AbortController();

    try {
      const sseResponse = await fetch(`${baseUrl}/mcp`, {
        headers: {
          accept: "text/event-stream"
        },
        signal: abort.signal
      });
      expect(sseResponse.status).toBe(200);

      await postRpc(baseUrl, {
        jsonrpc: "2.0",
        id: 1,
        method: "resources/subscribe",
        params: { uri: "sidecar://resources/demo" }
      });
      const notification = readSseMessage(sseResponse, (message) =>
        message.method === "notifications/resources/updated"
      );
      await postRpc(baseUrl, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "refresh_resource", arguments: {} }
      });

      await expect(notification).resolves.toMatchObject({
        jsonrpc: "2.0",
        method: "notifications/resources/updated",
        params: {
          uri: "sidecar://resources/demo"
        }
      });
    } finally {
      abort.abort();
      await close(http);
    }
  });

  it("streams request progress and the final response over POST SSE", async () => {
    const longTask = tool({
      name: "Long Task",
      description: "Use this when testing request progress notifications.",
      async execute(_params: {}, ctx) {
        await ctx.notify.progress({ progress: 1, total: 2, message: "Halfway." });
        return toolResult({
          structuredContent: { done: true },
          content: "Done."
        });
      }
    });
    const http = createSidecarHttpServer({
      tools: [{ tool: longTask }]
    });
    const baseUrl = await listen(http);

    try {
      const response = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "long_task",
            arguments: {},
            _meta: {
              progressToken: "progress-1"
            }
          }
        })
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      await expect(readSseMessages(response, 2)).resolves.toEqual([
        expect.objectContaining({
          jsonrpc: "2.0",
          method: "notifications/progress",
          params: {
            progressToken: "progress-1",
            progress: 1,
            total: 2,
            message: "Halfway."
          }
        }),
        expect.objectContaining({
          jsonrpc: "2.0",
          id: 1,
          result: expect.objectContaining({
            structuredContent: { done: true }
          })
        })
      ]);
    } finally {
      await close(http);
    }
  });

  it("enforces compiler-provided input and output schemas at runtime", async () => {
    const constrained = tool({
      name: "Constrained Tool",
      description: "Use this when checking runtime schema enforcement.",
      execute() {
        return toolResult({
          structuredContent: { count: "wrong" },
          content: "done"
        });
      }
    });
    const server = createSidecarMcpServer({
      tools: [{
        tool: constrained,
        descriptor: createToolDescriptor({
          name: "Constrained Tool",
          id: "constrained-tool",
          description: "Use this when checking runtime schema enforcement.",
          inputSchema: {
            type: "object",
            properties: {
              value: { type: "number" }
            },
            required: ["value"],
            additionalProperties: false
          },
          outputSchema: {
            type: "object",
            properties: {
              count: { type: "number" }
            },
            required: ["count"],
            additionalProperties: false
          }
        })
      }]
    });

    await expect(
      server.handle({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "constrained-tool", arguments: { value: "nope" } }
      })
    ).resolves.toMatchObject({
      error: {
        code: -32602,
        data: { validation: "$.value must be number." }
      }
    });

    await expect(
      server.handle({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "constrained-tool", arguments: { value: 1 } }
      })
    ).resolves.toMatchObject({
      error: {
        code: -32602,
        data: { validation: "$.count must be number." }
      }
    });
  });

  it("validates schema-shaped additionalProperties at runtime", async () => {
    const tagged = tool({
      name: "Tagged Tool",
      description: "Use this when checking additional property schemas.",
      execute(params: { fixed: string; [key: string]: unknown }) {
        return toolResult({
          structuredContent: { fixed: params.fixed, extra: "valid" },
          content: "Tagged."
        });
      }
    });
    const server = createSidecarMcpServer({
      tools: [{
        tool: tagged,
        descriptor: createToolDescriptor({
          name: "Tagged Tool",
          id: "tagged-tool",
          description: "Use this when checking additional property schemas.",
          inputSchema: {
            type: "object",
            properties: {
              fixed: { type: "string" }
            },
            required: ["fixed"],
            additionalProperties: { type: "string" }
          },
          outputSchema: {
            type: "object",
            properties: {
              fixed: { type: "string" }
            },
            required: ["fixed"],
            additionalProperties: { type: "string" }
          }
        })
      }]
    });

    await expect(
      server.handle({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "tagged-tool", arguments: { fixed: "ok", extra: 1 } }
      })
    ).resolves.toMatchObject({
      error: {
        code: -32602,
        data: { validation: "$.extra must be string." }
      }
    });

    await expect(
      server.handle({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "tagged-tool", arguments: { fixed: "ok", extra: "ok" } }
      })
    ).resolves.toMatchObject({
      result: {
        structuredContent: {
          fixed: "ok",
          extra: "valid"
        }
      }
    });
  });
});

type JsonRpcLike = { method?: string; [key: string]: unknown };

/** Reads the first matching JSON-RPC message from an SSE response. */
async function readSseMessage(
  response: Response,
  predicate: (message: JsonRpcLike) => boolean,
): Promise<JsonRpcLike> {
  const messages = await readSseMessages(response, 1, predicate);
  return messages[0] as JsonRpcLike;
}

/** Reads JSON payloads from Streamable HTTP SSE message events. */
async function readSseMessages(
  response: Response,
  count: number,
  predicate: (message: JsonRpcLike) => boolean = () => true,
): Promise<JsonRpcLike[]> {
  const body = response.body;
  if (!body) {
    throw new Error("Expected SSE response body.");
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const messages: JsonRpcLike[] = [];

  try {
    while (messages.length < count) {
      const chunk = await readStreamChunk(reader);
      if (chunk.done) {
        break;
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      let separator = buffer.indexOf("\n\n");
      while (separator !== -1) {
        const rawEvent = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const data = rawEvent
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice("data:".length).trimStart())
          .join("\n");
        if (data) {
          const parsed = JSON.parse(data) as JsonRpcLike;
          if (predicate(parsed)) {
            messages.push(parsed);
            if (messages.length >= count) {
              return messages;
            }
          }
        }
        separator = buffer.indexOf("\n\n");
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  return messages;
}

/** Reads one stream chunk with a timeout so failed SSE tests do not hang. */
function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timeout: NodeJS.Timeout | undefined;
  return Promise.race([
    reader.read(),
    new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("Timed out waiting for SSE message.")), 2_000);
    }),
  ]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

/** Creates the minimal context needed to execute tools in server tests. */
function testContext(): ToolContext {
  return {
    auth: undefined,
    request: {
      id: "test",
      signal: new AbortController().signal,
      host: "unknown",
      transport: "streamable-http"
    },
    services: {},
    tools: {},
    log: {
      debug() {},
      info() {},
      warn() {},
      error() {}
    },
    trace: {
      async span<T>(_name: string, run: () => T | Promise<T>): Promise<T> {
        return run();
      }
    },
    storage: {
      async get() {
        return undefined;
      },
      async set() {},
      async delete() {}
    },
    notify: {
      async progress() {},
      async toolsChanged() {},
      async resourcesChanged() {},
      async promptsChanged() {},
      async resourceUpdated() {}
    },
    env: {}
  };
}

/** Starts an HTTP server on an ephemeral local port. */
function listen(server: ReturnType<typeof createSidecarHttpServer>): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        resolve(`http://127.0.0.1:${address.port}`);
      }
    });
  });
}

/** Stops a test HTTP server. */
function close(server: ReturnType<typeof createSidecarHttpServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

/** Sends a Streamable HTTP JSON-RPC request with the required MCP headers. */
function postRpc(baseUrl: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream"
    },
    body: JSON.stringify(body)
  });
}
