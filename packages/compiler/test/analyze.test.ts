/** Tests for compiler discovery, schema extraction, widgets, and plugin output. */
import path from "node:path";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
  analyzeProjectConfig,
  analyzeProjectPrompts,
  analyzeProjectResources,
  analyzeProjectTools,
  buildProject,
  collectProjectDiagnostics,
  type SidecarToolManifestEntry,
} from "../src/index.js";

describe("analyzeProjectTools", () => {
  it("discovers reserved tool files and generates schemas", async () => {
    const rootDir = path.resolve(import.meta.dirname, "../../../examples/simple");
    const tools = await analyzeProjectTools(rootDir);

    expect(tools.map((entry: SidecarToolManifestEntry) => entry.id).sort()).toEqual(["add-numbers", "expenses.review"]);

    const add = tools.find((entry: SidecarToolManifestEntry) => entry.id === "add-numbers");
    expect(add?.inputSchema).toMatchObject({
      type: "object",
      properties: {
        a: { type: "number", description: "First number to add." },
        b: { type: "number", description: "Second number to add." }
      },
      required: ["a", "b"],
      additionalProperties: false
    });

    expect(add?.outputSchema).toMatchObject({
      type: "object",
      properties: {
        sum: { type: "number", description: "Sum of the two input numbers." }
      },
      required: ["sum"],
      additionalProperties: false
    });
  });

  it("discovers reserved resource and prompt files with folder-derived ids", async () => {
    const rootDir = path.resolve(import.meta.dirname, "../../../examples/simple");
    const config = analyzeProjectConfig(rootDir);
    const resources = await analyzeProjectResources(rootDir);
    const prompts = await analyzeProjectPrompts(rootDir);

    expect(config.build.plugins).toBe(true);
    expect(config.pagination.pageSize).toBe(50);
    expect(resources).toHaveLength(1);
    expect(resources[0]).toMatchObject({
      uri: "sidecar://resources/company-handbook",
      name: "Company Handbook",
      descriptor: {
        mimeType: "text/markdown",
        annotations: {
          audience: ["assistant"],
          priority: 0.7,
        },
      },
    });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({
      name: "review-expense",
      title: "Review Expense",
      descriptor: {
        arguments: [
          { name: "reportId", description: "Expense report id to review.", required: true },
          { name: "severity", description: "How urgent the review is.", required: false },
        ],
      },
    });
  });

  it("emits JSON object schemas for TypeScript record parameters", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "sidecar-record-schema-"));

    try {
      await writeFixture(
        path.join(rootDir, "server", "record-tool", "tool.ts"),
        `import { tool, toolResult } from "sidecar-ai";

type Params = {
  /** Arbitrary JSON object keyed by provider property name. */
  properties?: Record<string, unknown>;
  /** Arbitrary string map. */
  labels?: Record<string, string>;
};

export default tool({
  name: "Record Tool",
  description: "Use this when testing record schema inference.",
  execute(params: Params) {
    return toolResult({
      structuredContent: params,
      content: "ok"
    });
  }
});
`,
      );

      const [entry] = await analyzeProjectTools(rootDir);

      expect(entry?.inputSchema).toMatchObject({
        type: "object",
        properties: {
          properties: {
            type: "object",
            description: "Arbitrary JSON object keyed by provider property name.",
            additionalProperties: true,
          },
          labels: {
            type: "object",
            description: "Arbitrary string map.",
            additionalProperties: { type: "string" },
          },
        },
        required: [],
        additionalProperties: false,
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("deduplicates equivalent structured output branches into an object schema", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "sidecar-output-union-schema-"));

    try {
      await writeFixture(
        path.join(rootDir, "server", "branched-output", "tool.ts"),
        `import { tool, toolResult } from "sidecar-ai";

type Params = {
  value: string;
  includeMeta?: boolean;
};

type Result = {
  value: string;
};

export default tool({
  name: "Branched Output",
  description: "Use this when testing equivalent output branches.",
  execute(params: Params) {
    if (params.includeMeta) {
      const loaded: Result & { detail: string } = {
        value: params.value,
        detail: "remove-me"
      };
      const { detail: _detail, ...structuredContent } = loaded;

      return toolResult({
        structuredContent,
        meta: { source: "with-meta" },
        content: "ok"
      });
    }

    const structuredContent: Result = { value: params.value };

    return toolResult({
      structuredContent,
      content: "ok"
    });
  }
});
`,
      );

      const [entry] = await analyzeProjectTools(rootDir);

      expect(entry?.outputSchema).toEqual({
        type: "object",
        properties: {
          value: { type: "string" },
        },
        required: ["value"],
        additionalProperties: false,
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("keeps distinct structured output branches under an object root", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "sidecar-distinct-output-schema-"));

    try {
      await writeFixture(
        path.join(rootDir, "server", "distinct-output", "tool.ts"),
        `import { tool, toolResult } from "sidecar-ai";

type Params = {
  value: string;
  returnCount?: boolean;
};

export default tool({
  name: "Distinct Output",
  description: "Use this when testing distinct output branches.",
  execute(params: Params) {
    if (params.returnCount) {
      return toolResult({
        structuredContent: { count: params.value.length },
        content: "ok"
      });
    }

    return toolResult({
      structuredContent: { value: params.value },
      content: "ok"
    });
  }
});
`,
      );

      const [entry] = await analyzeProjectTools(rootDir);

      expect(entry?.outputSchema?.type).toBe("object");
      expect(entry?.outputSchema?.anyOf).toEqual([
        {
          type: "object",
          properties: { count: { type: "number" } },
          required: ["count"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
          additionalProperties: false,
        },
      ]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("converts runtime Zod params with Zod's JSON Schema converter", async () => {
    const rootDir = await createRuntimeImportFixture("sidecar-zod-schema-");

    try {
      await writeFixture(
        path.join(rootDir, "server", "zod-tool", "tool.ts"),
        `import { z } from "zod";
import { tool, toolResult, withParams } from "sidecar-ai";

const trimmedString = z
  .string()
  .min(2)
  .max(40)
  .describe("Search query.");

const mode = z.enum(["workspace", "user"] as const).optional();

const ParamsSchema = z.object({
  query: trimmedString,
  mode,
  tags: z.array(z.string().min(1)).min(1).optional(),
  email: z.string().email().optional(),
  slug: z.string().regex(/^foo-[0-9]+$/).optional(),
  withDefault: z.string().default("workspace"),
});

export default tool({
  name: "Zod Tool",
  description: "Use this when testing Zod schema extraction.",
  execute: withParams(ParamsSchema, (params) => {
    return toolResult({
      structuredContent: { query: params.query },
      content: "ok"
    });
  })
});
`,
      );

      const [entry] = await analyzeProjectTools(rootDir);

      expect(entry?.inputSchema).toMatchObject({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: {
          query: {
            type: "string",
            minLength: 2,
            maxLength: 40,
            description: "Search query.",
          },
          mode: {
            type: "string",
            enum: ["workspace", "user"],
          },
          tags: {
            type: "array",
            minItems: 1,
            items: {
              type: "string",
              minLength: 1,
            },
          },
          email: {
            type: "string",
            format: "email",
          },
          slug: {
            type: "string",
            pattern: "^foo-[0-9]+$",
          },
          withDefault: {
            type: "string",
            default: "workspace",
          },
        },
        required: ["query"],
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("falls back to execute parameter types when Zod cannot emit JSON Schema", async () => {
    const rootDir = await createRuntimeImportFixture("sidecar-zod-custom-schema-");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      await writeFixture(
        path.join(rootDir, "server", "zod-custom", "tool.ts"),
        `import { z } from "zod";
import { tool, toolResult, withParams } from "sidecar-ai";

type Params = {
  /** Search query after runtime normalization. */
  query: string;
};

const ParamsSchema = z.object({
  query: z.custom<string>((value) => typeof value === "string"),
});

export default tool({
  name: "Zod Transform",
  description: "Use this when testing Zod fallback behavior.",
  execute: withParams(ParamsSchema, (params: Params) => {
    return toolResult({
      structuredContent: { query: params.query },
      content: "ok"
    });
  })
});
`,
      );

      const [entry] = await analyzeProjectTools(rootDir);

      expect(entry?.inputSchema).toMatchObject({
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query after runtime normalization.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("falling back to TypeScript parameter inference"));
    } finally {
      warn.mockRestore();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("falls back to execute parameter types for non-Zod runtime validators", async () => {
    const rootDir = await createRuntimeImportFixture("sidecar-custom-validator-schema-");

    try {
      await writeFixture(
        path.join(rootDir, "server", "custom-validator", "tool.ts"),
        `import { tool, toolResult } from "sidecar-ai";

const params = {
  safeParse(value: unknown) {
    return { success: true as const, data: value as { value: string } };
  }
};

export default tool({
  name: "Custom Validator",
  description: "Use this when testing custom validators.",
  params,
  execute(input: { value: string }) {
    return toolResult({
      structuredContent: { value: input.value },
      content: "ok"
    });
  }
});
`,
      );

      const [entry] = await analyzeProjectTools(rootDir);
      expect(entry?.inputSchema).toMatchObject({
        type: "object",
        properties: {
          value: { type: "string" },
        },
        required: ["value"],
        additionalProperties: false,
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("supports one MCP server with both Zod params and TypeScript params", async () => {
    const rootDir = await createRuntimeImportFixture("sidecar-mixed-schema-");

    try {
      await writeFixture(
        path.join(rootDir, "server", "zod-search", "tool.ts"),
        `import { z } from "zod";
import { tool, toolResult, withParams } from "sidecar-ai";

const ParamsSchema = z.object({
  query: z.string().min(2).describe("Search query."),
  limit: z.number().int().min(1).max(20).optional(),
});

export default tool({
  name: "Zod Search",
  description: "Use this when searching with runtime validation.",
  execute: withParams(ParamsSchema, (params) => {
    return toolResult({
      structuredContent: { query: params.query },
      content: "ok"
    });
  })
});
`,
      );
      await writeFixture(
        path.join(rootDir, "server", "typed-create", "tool.ts"),
        `import { tool, toolResult } from "sidecar-ai";

type Params = {
  /** Page title to create. */
  title: string;
  /** Parent page id. */
  parentId?: string;
};

export default tool({
  name: "Typed Create",
  description: "Use this when creating with TypeScript params.",
  execute(params: Params) {
    return toolResult({
      structuredContent: { title: params.title },
      content: "ok"
    });
  }
});
`,
      );

      const tools = await analyzeProjectTools(rootDir);
      const zodSearch = tools.find((entry) => entry.id === "zod-search");
      const typedCreate = tools.find((entry) => entry.id === "typed-create");

      expect(zodSearch?.inputSchema).toMatchObject({
        type: "object",
        properties: {
          query: {
            type: "string",
            minLength: 2,
            description: "Search query.",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 20,
          },
        },
        required: ["query"],
      });
      expect(typedCreate?.inputSchema).toMatchObject({
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Page title to create.",
          },
          parentId: {
            type: "string",
            description: "Parent page id.",
          },
        },
        required: ["title"],
        additionalProperties: false,
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("builds widget resources, generated clients, and plugin packages", async () => {
    const fixture = path.resolve(import.meta.dirname, "../../../examples/simple");
    const rootDir = await mkdtemp(path.join(tmpdir(), "sidecar-simple-"));

    try {
      await cp(fixture, rootDir, { recursive: true });
      const manifest = await buildProject({ rootDir, outDir: "out/chatgpt", plugins: true, target: "chatgpt" });
      const widgetTool = manifest.tools.find((entry: SidecarToolManifestEntry) => entry.id === "add-numbers");

      expect(widgetTool?.widget?.resourceUri).toMatch(/^ui:\/\/add-numbers\/widget\.[a-f0-9]{12}\.html$/);
      expect(widgetTool?.descriptor._meta).toMatchObject({
        ui: {
          resourceUri: widgetTool?.widget?.resourceUri,
        },
        "openai/outputTemplate": widgetTool?.widget?.resourceUri,
        "openai/widgetCSP": {
          connect_domains: [],
          resource_domains: []
        }
      });
      expect(widgetTool?.widget?.resourceMeta).toMatchObject({
        ui: {
          csp: {
            connectDomains: [],
            resourceDomains: []
          }
        }
      });

      const reviewTool = manifest.tools.find((entry: SidecarToolManifestEntry) => entry.id === "expenses.review");
      expect(reviewTool?.descriptor.securitySchemes).toEqual([
        { type: "oauth2", scopes: ["expenses.read"] }
      ]);
      expect(reviewTool?.descriptor._meta).toMatchObject({
        securitySchemes: [{ type: "oauth2", scopes: ["expenses.read"] }],
        "openai/toolInvocation/invoking": "Reviewing expense report",
        "openai/toolInvocation/invoked": "Expense report reviewed"
      });

      await expect(readFile(path.join(rootDir, ".sidecar/generated/tools.ts"), "utf8")).resolves.toContain("createToolClient");
      await expect(readFile(path.join(rootDir, "out/chatgpt", widgetTool?.widget?.outputFile ?? ""), "utf8")).resolves.toContain("data-sc-component");
      await expect(readFile(path.join(rootDir, "out/chatgpt", widgetTool?.widget?.outputFile ?? ""), "utf8")).resolves.toContain(".sidecar-example-output");
      await expect(readFile(path.join(rootDir, "out/chatgpt", widgetTool?.widget?.outputFile ?? ""), "utf8")).resolves.toContain("--app-font-sans");
      await expect(readFile(path.join(rootDir, "out/chatgpt", widgetTool?.widget?.outputFile ?? ""), "utf8")).resolves.toContain("--app-surface");
      await expect(readFile(path.join(rootDir, "out/chatgpt", widgetTool?.widget?.outputFile ?? ""), "utf8")).resolves.toContain(".grid");
      await expect(readFile(path.join(rootDir, "out/claude-plugin/.claude-plugin/plugin.json"), "utf8")).resolves.toContain("available");
      await expect(readFile(path.join(rootDir, "out/claude-plugin/skills/review-writer/SKILL.md"), "utf8")).resolves.toContain("expense review summary");
      await expect(readFile(path.join(rootDir, "out/claude-plugin/commands/review-summary.md"), "utf8")).resolves.toContain('allowed-tools: "expenses.review"');
      await expect(readFile(path.join(rootDir, "out/claude-plugin/agents/review-writer.md"), "utf8")).resolves.toContain('disallowed-tools: "Write"');
      await expect(readFile(path.join(rootDir, "out/claude-plugin/hooks/hooks.json"), "utf8")).resolves.toContain("SubagentStop");
      await expect(readFile(path.join(rootDir, "out/claude-plugin/hooks/hooks.json"), "utf8")).resolves.toContain("PreToolUse");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("reports editor-friendly project diagnostics", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "sidecar-diagnostics-"));

    try {
      await writeFixture(
        path.join(rootDir, "server", "raw-openai", "tool.ts"),
        `import { tool, toolResult } from "sidecar-ai";

type Params = {
  q: string;
};

export default tool({
  name: "Raw OpenAI",
  description: "Does a thing.",
  execute(params: Params) {
    return toolResult({
      structuredContent: { q: params.q },
      content: params.q
    });
  }
});
`,
      );
      await writeFixture(
        path.join(rootDir, "server", "raw-openai", "widget.tsx"),
        `export default function Widget() {
  window.openai?.setWidgetState?.({});
  return null;
}
`,
      );
      await writeFixture(
        path.join(rootDir, "server", "plain-return", "tool.ts"),
        `import { tool } from "sidecar-ai";

export default tool({
  name: "Plain Return",
  description: "Use this when checking tool result diagnostics.",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false
  },
  execute() {
    return {
      content: "plain"
    };
  }
});
`,
      );

      const tools = await analyzeProjectTools(rootDir);
      const diagnostics = await collectProjectDiagnostics(rootDir, tools);

      expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
        expect.arrayContaining([
          "SIDECAR_METADATA_DESCRIPTION",
          "SIDECAR_TOOL_ANNOTATION",
          "SIDECAR_PARAM_DESCRIPTION",
          "SIDECAR_OPENAI_RAW_BRIDGE",
          "SIDECAR_TOOL_RESULT_REQUIRED"
        ])
      );
      const rawOpenAiDiagnostic = diagnostics.find(
        (diagnostic) => diagnostic.filePath === "server/raw-openai/tool.ts",
      );
      expect(rawOpenAiDiagnostic).toMatchObject({
        filePath: "server/raw-openai/tool.ts",
        line: expect.any(Number),
        column: expect.any(Number)
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("warns when resources do not return resourceResult", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "sidecar-resource-diagnostics-"));

    try {
      await writeFixture(
        path.join(rootDir, "resources", "plain", "resource.ts"),
        `import { resource } from "sidecar-ai";

export default resource({
  name: "Plain Resource",
  read() {
    return { content: "plain" };
  }
});
`,
      );

      const resources = await analyzeProjectResources(rootDir);
      const diagnostics = await collectProjectDiagnostics(rootDir, {
        tools: [],
        resources,
      });

      expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        "SIDECAR_RESOURCE_RESULT_REQUIRED",
      );
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("errors when per-resource subscriptions are enabled without server support", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "sidecar-resource-subscribe-"));

    try {
      await writeFixture(
        path.join(rootDir, "sidecar.config.ts"),
        `import { defineConfig } from "sidecar-ai";

export default defineConfig({
  name: "Subscribe Fixture",
  version: "0.1.0",
  description: "Checks subscription diagnostics."
});
`,
      );
      await writeFixture(
        path.join(rootDir, "resources", "live", "resource.ts"),
        `import { resource, resourceResult } from "sidecar-ai";

export default resource({
  name: "Live Resource",
  subscribe: true,
  read() {
    return resourceResult({ content: "live" });
  }
});
`,
      );

      const resources = await analyzeProjectResources(rootDir);
      const diagnostics = await collectProjectDiagnostics(rootDir, {
        tools: [],
        resources,
        config: analyzeProjectConfig(rootDir),
      });

      expect(diagnostics).toContainEqual(expect.objectContaining({
        severity: "error",
        code: "SIDECAR_RESOURCE_SUBSCRIBE_DISABLED",
      }));
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("accepts named default exports and reads widget-owned metadata", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "sidecar-reserved-helpers-"));

    try {
      await writeFixture(
        path.join(rootDir, "server", "folder-id", "tool.ts"),
        `import { tool, toolResult } from "sidecar-ai";

const declaredTool = tool({
  name: "Folder Named Tool",
  description: "Use this when checking reserved helper declarations.",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false
  },
  execute() {
    return toolResult({
      structuredContent: { ok: true },
      content: "ok"
    });
  }
});

export default declaredTool;
`,
      );
      await writeFixture(
        path.join(rootDir, "server", "folder-id", "widget.tsx"),
        `import { widget } from "@sidecar-ai/react";

function Widget() {
  return null;
}

const declaredWidget = widget(
  {
    description: "Widget-owned description.",
    prefersBorder: true,
    csp: {
      connectDomains: ["https://api.example.com"],
      resourceDomains: ["https://cdn.example.com"],
      frameDomains: ["https://frame.example.com"]
    },
    hosts: {
      chatgpt: {
        domain: "https://widgets.example.com",
        redirectDomains: ["https://example.com"]
      }
    }
  },
  Widget
);

export default declaredWidget;
`,
      );

      const [entry] = await analyzeProjectTools(rootDir, { target: "chatgpt" });

      expect(entry).toMatchObject({
        id: "folder-id",
        widget: {
          options: {
            description: "Widget-owned description.",
            prefersBorder: true,
          },
        },
      });
      expect(entry?.descriptor._meta).toMatchObject({
        ui: {
          resourceUri: "ui://folder-id/widget.html",
        },
        "openai/widgetDescription": "Widget-owned description.",
        "openai/widgetDomain": "https://widgets.example.com",
        "openai/widgetCSP": {
          connect_domains: ["https://api.example.com"],
          resource_domains: ["https://cdn.example.com"],
          frame_domains: ["https://frame.example.com"],
          redirect_domains: ["https://example.com"],
        },
      });
      expect(entry?.widget?.resourceMeta).toMatchObject({
        ui: {
          prefersBorder: true,
          csp: {
            connectDomains: ["https://api.example.com"],
            resourceDomains: ["https://cdn.example.com"],
            frameDomains: ["https://frame.example.com"],
          },
        },
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("omits model-only tools from generated widget clients", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "sidecar-visibility-"));

    try {
      await writeFixture(
        path.join(rootDir, "server", "model-only", "tool.ts"),
        visibilityFixture("Model Only", "widgets: false"),
      );
      await writeFixture(
        path.join(rootDir, "server", "app-only", "tool.ts"),
        visibilityFixture("App Only", "model: false"),
      );
      await writeFixture(
        path.join(rootDir, "server", "default-tool", "tool.ts"),
        visibilityFixture("Default Tool", ""),
      );

      await buildProject({ rootDir, outDir: "out/mcp" });
      const generated = await readFile(path.join(rootDir, ".sidecar/generated/tools.ts"), "utf8");

      expect(generated).not.toContain("modelOnly(");
      expect(generated).toContain("appOnly(");
      expect(generated).toContain("defaultTool(");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("warns when widgets import host-pinned components in cross-host code", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "sidecar-host-components-"));

    try {
      await writeFixture(
        path.join(rootDir, "server", "component-test", "tool.ts"),
        `import { tool, toolResult } from "sidecar-ai";

export default tool({
  name: "Component Test",
  description: "Use this when checking component imports.",
  execute() {
    return toolResult({
      structuredContent: { ok: true },
      content: "ok"
    });
  }
});
`,
      );
      await writeFixture(
        path.join(rootDir, "server", "component-test", "widget.tsx"),
        `import { Popover } from "@sidecar-ai/openai/components";

export default function Widget() {
  return <Popover trigger="More">OpenAI only</Popover>;
}
`,
      );

      const tools = await analyzeProjectTools(rootDir);
      const diagnostics = await collectProjectDiagnostics(rootDir, tools);

      expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        "SIDECAR_OPENAI_COMPONENT_CROSS_HOST",
      );
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("selects platform-specific tool and widget files by build target", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "sidecar-targets-"));

    try {
      await writeFixture(
        path.join(rootDir, "server", "demo", "tool.ts"),
        `import { tool, toolResult } from "sidecar-ai";

export default tool({
  name: "Demo Tool",
  description: "Use this when running the shared demo tool.",
  execute() {
    return toolResult({
      structuredContent: { target: "shared" },
      content: "shared"
    });
  }
});
`,
      );
      await writeFixture(
        path.join(rootDir, "server", "demo", "tool.openai.ts"),
        `import { tool, toolResult } from "sidecar-ai";

export default tool({
  name: "Demo Tool",
  description: "Use this when running the ChatGPT demo tool.",
  execute() {
    return toolResult({
      structuredContent: { target: "openai" },
      content: "openai"
    });
  }
});
`,
      );
      await writeFixture(
        path.join(rootDir, "server", "demo", "widget.tsx"),
        `export default function Widget() {
  return <div>shared</div>;
}
`,
      );
      await writeFixture(
        path.join(rootDir, "server", "demo", "widget.openai.tsx"),
        `import { Button } from "@sidecar-ai/openai/components";

export default function Widget() {
  return <Button>openai</Button>;
}
`,
      );

      const mcpTools = await analyzeProjectTools(rootDir, { target: "mcp" });
      expect(mcpTools[0]).toMatchObject({
        sourceFile: path.join("server", "demo", "tool.ts"),
        variant: "shared",
        target: "mcp",
        widget: {
          sourceFile: path.join("server", "demo", "widget.tsx"),
          variant: "shared",
        },
      });
      expect(mcpTools[0]?.descriptor._meta).not.toHaveProperty("openai/outputTemplate");

      const chatgptTools = await analyzeProjectTools(rootDir, { target: "chatgpt" });
      expect(chatgptTools[0]).toMatchObject({
        sourceFile: path.join("server", "demo", "tool.openai.ts"),
        variant: "openai",
        target: "chatgpt",
        widget: {
          sourceFile: path.join("server", "demo", "widget.openai.tsx"),
          variant: "openai",
        },
      });
      expect(chatgptTools[0]?.descriptor._meta).toHaveProperty("openai/outputTemplate");

      const diagnostics = await collectProjectDiagnostics(rootDir, chatgptTools);
      expect(diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
        "SIDECAR_OPENAI_COMPONENT_CROSS_HOST",
      );
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

/** Writes a fixture file after creating its parent directories. */
async function writeFixture(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

/**
 * Creates a runtime-import fixture inside the repo so Node resolves workspace
 * dependencies through the normal parent directory lookup.
 */
async function createRuntimeImportFixture(prefix: string): Promise<string> {
  const fixtureRoot = path.join(process.cwd(), ".tmp", "compiler-fixtures");
  await mkdir(fixtureRoot, { recursive: true });
  const rootDir = await mkdtemp(path.join(fixtureRoot, prefix));
  await linkFixtureNodeModules(rootDir);
  return rootDir;
}

/** Gives runtime-import fixture tools a lightweight sidecar-ai package shim. */
async function linkFixtureNodeModules(rootDir: string): Promise<void> {
  const nodeModules = path.join(rootDir, "node_modules");
  await mkdir(nodeModules, { recursive: true });

  const sidecarPackage = path.join(nodeModules, "sidecar-ai");
  await mkdir(sidecarPackage, { recursive: true });
  await writeFile(
    path.join(sidecarPackage, "package.json"),
    JSON.stringify({
      type: "module",
      exports: {
        ".": "./index.js",
      },
    }),
  );
  await writeFile(
    path.join(sidecarPackage, "index.js"),
    `const toolBrand = Symbol.for("sidecar.tool");
const toolExecuteParamsBrand = Symbol.for("sidecar.withParams");
const toolResultBrand = Symbol.for("sidecar.toolResult");

export function withParams(params, execute) {
  Object.defineProperties(execute, {
    kind: { value: "sidecar.withParams", enumerable: false },
    params: { value: params, enumerable: false },
    [toolExecuteParamsBrand]: { value: true, enumerable: false }
  });
  return execute;
}

export function tool(definition) {
  const executeParams = definition.execute?.[toolExecuteParamsBrand]
    ? definition.execute.params
    : undefined;
  return Object.freeze({
    ...definition,
    params: definition.params ?? executeParams,
    kind: "sidecar.tool",
    [toolBrand]: true
  });
}

export function toolResult(input) {
  return Object.freeze({
    ...input,
    kind: "sidecar.toolResult",
    [toolResultBrand]: true
  });
}
`,
  );
}

/** Creates a minimal tool fixture with optional visibility metadata. */
function visibilityFixture(name: string, visibility: string): string {
  return `import { tool, toolResult } from "sidecar-ai";

export default tool({
  name: ${JSON.stringify(name)},
  description: "Use this when checking generated widget tool visibility.",
  ${visibility ? `visibility: { ${visibility} },` : ""}
  execute() {
    return toolResult({
      structuredContent: { ok: true },
      content: "ok"
    });
  }
});
`;
}
