/** Tests for MCP JSON-RPC dispatch and auth enforcement. */
import { describe, expect, it } from "vitest";
import { result, tool, type ToolContext } from "@sidecar/core";
import { auth, scope, type AuthSession } from "@sidecar/auth";
import { createSidecarMcpServer } from "../src/index.js";

describe("SidecarMcpServer", () => {
  it("lists and calls tools", async () => {
    const add = tool({
      name: "Add Numbers",
      description: "Use this when adding two numbers.",
      execute(params: { a: number; b: number }) {
        return { sum: params.a + params.b };
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
        return { orgId: ctx.auth.orgId };
      }
    });
    const publicSummary = tool({
      name: "Public Summary",
      description: "Use this when returning public summary information.",
      execute() {
        return { public: true };
      }
    });
    const account = tool({
      name: "Account Info",
      description: "Use this when returning authenticated account information.",
      auth: {
        authenticated: true
      },
      execute(_params: {}, ctx: ToolContext<DemoSession>) {
        return { orgId: ctx.auth.orgId };
      }
    });

    const server = createSidecarMcpServer({
      auth: appAuth,
      tools: [{ tool: review }, { tool: publicSummary }, { tool: account }],
      createContext: () => testContext()
    });

    await expect(
      server.handle({
        jsonrpc: "2.0",
        id: 0,
        method: "tools/call",
        params: { name: "public_summary", arguments: {} }
      })
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
    result,
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
