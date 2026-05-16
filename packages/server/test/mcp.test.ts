import { describe, expect, it } from "vitest";
import { result, tool, type ToolContext } from "@sidecar/core";
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
});

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
