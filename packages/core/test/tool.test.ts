/** Tests for core tool declaration and result normalization. */
import { describe, expect, it } from "vitest";
import { createToolDescriptor, executeTool, tool, toolResult, type ToolContext } from "../src/index.js";

describe("tool", () => {
  it("normalizes a sync execute toolResult into an MCP tool result", async () => {
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

    await expect(executeTool(add, { a: 2, b: 3 }, testContext())).resolves.toMatchObject({
      structuredContent: { sum: 5 },
      content: [{ type: "text", text: "The sum is 5." }]
    });
  });

  it("normalizes an async execute result with custom content and meta", async () => {
    const review = tool({
      name: "Review Expense",
      description: "Use this when reviewing one expense report.",
      async execute() {
        return toolResult({
          structuredContent: { status: "ready" },
          content: "The report is ready.",
          meta: { "com.example/trace": "abc" }
        });
      }
    });

    await expect(executeTool(review, {}, testContext())).resolves.toMatchObject({
      structuredContent: { status: "ready" },
      content: [{ type: "text", text: "The report is ready." }],
      _meta: { "com.example/trace": "abc" }
    });
  });

  it("rejects execute results not created by toolResult", async () => {
    const unsafe = tool({
      name: "Unsafe Result",
      description: "Use this when checking invalid runtime returns.",
      execute() {
        return { structuredContent: { ok: true }, content: [{ type: "text", text: "ok" }] };
      }
    } as never);

    await expect(executeTool(unsafe, {}, testContext())).rejects.toMatchObject({
      code: "invalid_tool_result"
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
