/** Tests for compiler discovery, schema extraction, widgets, and plugin output. */
import path from "node:path";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
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

    expect(config.pagination.pageSize).toBe(10);
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
      await expect(readFile(path.join(rootDir, "out/chatgpt", widgetTool?.widget?.outputFile ?? ""), "utf8")).resolves.toContain("SidecarWidgetRoot");
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
