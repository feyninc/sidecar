/** Tests for core tool declaration and result normalization. */
import { describe, expect, it } from "vitest";
import {
  createPromptDescriptor,
  createResourceDescriptor,
  createToolDescriptor,
  executePrompt,
  executeResource,
  executeTool,
  offsetPagination,
  prompt,
  resource,
  resourceResult,
  tool,
  toolResult,
  type ToolContext,
} from "../src/index.js";

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

  it("advertises tool auth requirements in descriptor security schemes", () => {
    const descriptor = createToolDescriptor({
      name: "Review Expense Report",
      description: "Use this when reviewing one expense report.",
      auth: {
        scopes: [{
          kind: "sidecar.scope",
          id: "expenses.read",
          description: "Read expenses."
        }]
      }
    });

    expect(descriptor.securitySchemes).toEqual([
      { type: "oauth2", scopes: ["expenses.read"] }
    ]);
    expect(descriptor._meta).toMatchObject({
      securitySchemes: [{ type: "oauth2", scopes: ["expenses.read"] }]
    });
  });

  it("normalizes resourceResult values into MCP resource contents", async () => {
    const handbook = resource({
      name: "Company Handbook",
      mimeType: "text/markdown",
      read() {
        return resourceResult({
          content: "# Handbook",
          annotations: {
            audience: ["assistant"],
            priority: 0.8
          }
        });
      }
    });

    await expect(
      executeResource(handbook, testContext(), {
        uri: "sidecar://resources/company-handbook",
      })
    ).resolves.toEqual({
      contents: [{
        uri: "sidecar://resources/company-handbook",
        mimeType: "text/markdown",
        text: "# Handbook",
        annotations: {
          audience: ["assistant"],
          priority: 0.8,
        },
      }]
    });
  });

  it("rejects resource reads not created by resourceResult", async () => {
    const unsafe = resource({
      name: "Unsafe Resource",
      read() {
        return { content: "plain" };
      }
    } as never);

    await expect(
      executeResource(unsafe, testContext(), {
        uri: "sidecar://resources/unsafe",
      })
    ).rejects.toMatchObject({
      code: "invalid_resource_result"
    });
  });

  it("creates MCP-safe resource and prompt descriptors", () => {
    expect(createResourceDescriptor({
      uri: "sidecar://resources/company-handbook",
      name: "Company Handbook",
      mimeType: "text/markdown"
    })).toMatchObject({
      uri: "sidecar://resources/company-handbook",
      name: "Company Handbook",
      mimeType: "text/markdown"
    });

    expect(createPromptDescriptor({
      name: "review-expense",
      title: "Review Expense",
      args: {
        reportId: "Expense report id.",
        urgency: { description: "Optional urgency.", required: false }
      }
    })).toMatchObject({
      name: "review-expense",
      title: "Review Expense",
      arguments: [
        { name: "reportId", description: "Expense report id.", required: true },
        { name: "urgency", description: "Optional urgency.", required: false }
      ]
    });
  });

  it("normalizes prompt string returns into MCP prompt messages", async () => {
    const review = prompt({
      title: "Review Expense",
      args: {
        reportId: "Expense report id."
      },
      run({ reportId }: { reportId: string }) {
        return `Review ${reportId}.`;
      }
    });

    await expect(
      executePrompt(review, { reportId: "exp_123" }, testContext())
    ).resolves.toEqual({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: "Review exp_123.",
        },
      }],
    });

    await expect(executePrompt(review, {}, testContext())).rejects.toMatchObject({
      code: "invalid_prompt_args",
    });
  });

  it("paginates in-memory lists with opaque offset cursors", () => {
    const first = offsetPagination({
      items: ["a", "b", "c"],
      pageSize: 2,
    });
    expect(first).toMatchObject({
      items: ["a", "b"],
      nextCursor: expect.any(String),
    });
    expect(offsetPagination({
      items: ["a", "b", "c"],
      cursor: first.nextCursor,
      pageSize: 2,
    })).toEqual({
      items: ["c"],
      nextCursor: undefined,
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
