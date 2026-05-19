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
  withParams,
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

  it("uses withParams validators attached to execute functions", async () => {
    const params = {
      safeParse(value: unknown) {
        const input = value as { q?: unknown };
        return typeof input.q === "string" && input.q.length > 0
          ? { success: true as const, data: { q: input.q } }
          : { success: false as const, error: new Error("q is required") };
      },
    };

    const search = tool({
      name: "Search Pages",
      description: "Use this when searching pages.",
      execute: withParams(params, (input) =>
        toolResult({
          structuredContent: { q: input.q },
          content: input.q,
        }),
      ),
    });

    await expect(executeTool(search, { q: "docs" }, testContext())).resolves.toMatchObject({
      structuredContent: { q: "docs" },
      content: [{ type: "text", text: "docs" }],
    });
    await expect(executeTool(search, {}, testContext())).rejects.toMatchObject({
      code: "invalid_tool_params",
    });
  });

  it("rejects tools that declare params both directly and through withParams", () => {
    const params = {
      safeParse(value: unknown) {
        return { success: true as const, data: value as { q: string } };
      },
    };
    const otherParams = {
      safeParse(value: unknown) {
        return { success: true as const, data: value as { q: string } };
      },
    };

    expect(() =>
      tool({
        name: "Double Params",
        description: "Use this when testing invalid schema declarations.",
        params,
        execute: withParams(otherParams, (input) =>
          toolResult({
            structuredContent: { q: input.q },
            content: input.q,
          }),
        ),
      }),
    ).toThrow(/declares params twice/);
  });

  it("removes undefined values from structured content and meta before MCP output", async () => {
    const preview = tool({
      name: "Preview Optional Data",
      description: "Use this when checking JSON result normalization.",
      execute() {
        return toolResult({
          structuredContent: {
            preview: {
              title: "Ready",
              url: undefined,
              nested: {
                kept: true,
                omitted: undefined,
              },
            },
            rows: [{ value: 1, skip: undefined }, undefined, { value: 2 }],
          },
          content: "ready",
          meta: {
            trace: undefined,
            widget: {
              mode: "preview",
              missing: undefined,
            },
          },
        });
      },
    });

    await expect(executeTool(preview, {}, testContext())).resolves.toEqual({
      structuredContent: {
        preview: {
          title: "Ready",
          nested: {
            kept: true,
          },
        },
        rows: [{ value: 1 }, { value: 2 }],
      },
      content: [{ type: "text", text: "ready" }],
      _meta: {
        widget: {
          mode: "preview",
        },
      },
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
