/** Tests for core tool declaration and result normalization. */
import { describe, expect, it } from "vitest";
import { createToolDescriptor, executeTool, result, tool, type ToolContext } from "../src/index.js";

describe("tool", () => {
  it("normalizes a sync execute result into an MCP tool result", async () => {
    const add = tool({
      name: "Add Numbers",
      description: "Use this when adding two numbers.",
      execute(params: { a: number; b: number }) {
        return { sum: params.a + params.b };
      }
    });

    await expect(executeTool(add, { a: 2, b: 3 }, testContext())).resolves.toMatchObject({
      structuredContent: { sum: 5 },
      content: [{ type: "text", text: "{\"sum\":5}" }]
    });
  });

  it("normalizes an async execute result with custom content and meta", async () => {
    const review = tool({
      name: "Review Expense",
      description: "Use this when reviewing one expense report.",
      async execute() {
        return result(
          { status: "ready" },
          {
            content: "The report is ready.",
            meta: { "com.example/trace": "abc" }
          }
        );
      }
    });

    await expect(executeTool(review, {}, testContext())).resolves.toMatchObject({
      structuredContent: { status: "ready" },
      content: [{ type: "text", text: "The report is ready." }],
      _meta: { "com.example/trace": "abc" }
    });
  });

  it("creates MCP-safe tool descriptors", () => {
    const descriptor = createToolDescriptor({
      name: "Review Expense Report",
      description: "Use this when reviewing one expense report."
    });

    expect(descriptor.name).toBe("review_expense_report");
    expect(descriptor.title).toBe("Review Expense Report");
    expect(descriptor.inputSchema).toEqual({
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false
    });
  });
});

/** Creates the minimal context needed to execute a tool in tests. */
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
