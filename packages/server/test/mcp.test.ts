/** Tests for MCP JSON-RPC dispatch and auth enforcement. */
import { describe, expect, it } from "vitest";
import { createToolDescriptor, tool, toolResult, type ToolContext } from "@sidecar/core";
import { auth, scope, type AuthSession } from "@sidecar/auth";
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
});

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
