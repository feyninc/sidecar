/** Tests for Sidecar's editor-facing diagnostics and reserved-file tripwires. */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeProjectTools, collectProjectDiagnostics } from "../src/index.js";

describe("collectProjectDiagnostics", () => {
  it("warns for missing auth config and accepts auth.ts as the project authority", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "sidecar-auth-diagnostics-"));

    try {
      await writeTool(rootDir, "private-tool", {
        extraProperties: `auth: { scopes: ["reports:read"] },`,
      });

      const missingAuthTools = await analyzeProjectTools(rootDir);
      const missingAuthDiagnostics = await collectProjectDiagnostics(rootDir, missingAuthTools);
      expect(codes(missingAuthDiagnostics)).toContain("SIDECAR_AUTH_MISSING_CONFIG");

      await writeFixture(
        path.join(rootDir, "auth.ts"),
        `import { auth } from "sidecar-ai";

export default auth({
  scopes: {
    reportsRead: {
      value: "reports:read",
      description: "Read reports."
    }
  },
  async authenticate() {
    return { subject: "user_123", scopes: ["reports:read"] };
  }
});
`,
      );

      const configuredAuthTools = await analyzeProjectTools(rootDir);
      const configuredAuthDiagnostics = await collectProjectDiagnostics(rootDir, configuredAuthTools);
      expect(codes(configuredAuthDiagnostics)).not.toContain("SIDECAR_AUTH_MISSING_CONFIG");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("warns for non-standard knowledge search shapes unless explicitly ignored", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "sidecar-knowledge-diagnostics-"));

    try {
      await writeTool(rootDir, "search-docs", {
        params: `type Params = {
  /** Search text supplied by the user. */
  q: string;
};`,
        executeParams: "params: Params",
        structuredContent: "{ q: params.q }",
        content: "params.q",
      });

      const tools = await analyzeProjectTools(rootDir);
      const diagnostics = await collectProjectDiagnostics(rootDir, tools);
      expect(codes(diagnostics)).toContain("SIDECAR_COMPANY_KNOWLEDGE_SHAPE");

      await writeTool(rootDir, "search-docs", {
        leadingComment: "// sidecar-ignore SIDECAR_COMPANY_KNOWLEDGE_SHAPE",
        params: `type Params = {
  /** Search text supplied by the user. */
  q: string;
};`,
        executeParams: "params: Params",
        structuredContent: "{ q: params.q }",
        content: "params.q",
      });

      const ignoredTools = await analyzeProjectTools(rootDir);
      const ignoredDiagnostics = await collectProjectDiagnostics(rootDir, ignoredTools);
      expect(codes(ignoredDiagnostics)).not.toContain("SIDECAR_COMPANY_KNOWLEDGE_SHAPE");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("warns for host-pinned component imports in shared widgets", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "sidecar-host-diagnostics-"));

    try {
      await writeTool(rootDir, "host-test");
      await writeFixture(
        path.join(rootDir, "server", "host-test", "widget.tsx"),
        `import { Button } from "@sidecar-ai/anthropic/components";

export default function Widget() {
  return <Button>Claude only</Button>;
}
`,
      );

      const tools = await analyzeProjectTools(rootDir);
      const diagnostics = await collectProjectDiagnostics(rootDir, tools);
      expect(codes(diagnostics)).toContain("SIDECAR_ANTHROPIC_COMPONENT_CROSS_HOST");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("errors with an install command when OpenAI components are used without the official SDK", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "sidecar-openai-sdk-missing-"));

    try {
      await writeFixture(
        path.join(rootDir, "server", "openai-component-test", "tool.openai.ts"),
        toolSource({
          name: "OpenAI Component Test",
          description: "Use this when checking OpenAI SDK diagnostics.",
        }),
      );
      await writeFixture(
        path.join(rootDir, "server", "openai-component-test", "widget.openai.tsx"),
        `import { Button } from "@sidecar-ai/openai/components";

export default function Widget() {
  return <Button>ChatGPT only</Button>;
}
`,
      );

      const tools = await analyzeProjectTools(rootDir, { target: "chatgpt" });
      const diagnostics = await collectProjectDiagnostics(rootDir, tools);
      const missingSdk = diagnostics.find((diagnostic) => diagnostic.code === "SIDECAR_OPENAI_UI_SDK_MISSING");

      expect(missingSdk).toMatchObject({
        severity: "error",
        hint: "Install it with: npm install @openai/apps-sdk-ui",
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("allows diagnostics to be suppressed with visible source comments", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "sidecar-ignore-diagnostics-"));

    try {
      await writeTool(rootDir, "raw-widget");
      await writeFixture(
        path.join(rootDir, "server", "raw-widget", "widget.tsx"),
        `// sidecar-ignore SIDECAR_OPENAI_RAW_BRIDGE
export default function Widget() {
  window.openai?.setWidgetState?.({});
  return null;
}
`,
      );

      const tools = await analyzeProjectTools(rootDir);
      const diagnostics = await collectProjectDiagnostics(rootDir, tools);
      expect(codes(diagnostics)).not.toContain("SIDECAR_OPENAI_RAW_BRIDGE");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("rejects platform-specific widgets attached to shared tool files", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "sidecar-widget-hierarchy-"));

    try {
      await writeTool(rootDir, "platform-widget");
      await writeFixture(
        path.join(rootDir, "server", "platform-widget", "widget.openai.tsx"),
        `export default function Widget() {
  return <div>ChatGPT only</div>;
}
`,
      );

      await expect(analyzeProjectTools(rootDir, { target: "chatgpt" }))
        .rejects.toThrow("widget.openai.tsx requires a sibling tool.openai.ts");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("does not attach shared widgets to platform-specific tools", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "sidecar-platform-tool-widget-"));

    try {
      await writeFixture(
        path.join(rootDir, "server", "platform-tool", "tool.openai.ts"),
        toolSource({
          name: "Platform Tool",
          description: "Use this when checking platform-specific widget hierarchy.",
        }),
      );
      await writeFixture(
        path.join(rootDir, "server", "platform-tool", "widget.tsx"),
        `export default function Widget() {
  return <div>Shared widget</div>;
}
`,
      );

      const [entry] = await analyzeProjectTools(rootDir, { target: "chatgpt" });
      expect(entry?.variant).toBe("openai");
      expect(entry?.widget).toBeUndefined();
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

type ToolOptions = {
  name?: string;
  description?: string;
  leadingComment?: string;
  params?: string;
  executeParams?: string;
  extraProperties?: string;
  structuredContent?: string;
  content?: string;
};

/** Writes a reserved tool fixture with model-friendly defaults. */
async function writeTool(rootDir: string, directory: string, options: ToolOptions = {}): Promise<void> {
  await writeFixture(
    path.join(rootDir, "server", directory, "tool.ts"),
    toolSource({
      name: options.name ?? "Diagnostic Tool",
      description: options.description ?? "Use this when checking Sidecar diagnostics.",
      ...options,
    }),
  );
}

/** Renders a complete tool source fixture. */
function toolSource(options: ToolOptions = {}): string {
  const params = options.params ?? `type Params = {
  /** User-facing input value. */
  value: string;
};`;
  const executeParams = options.executeParams ?? "params: Params";
  const structuredContent = options.structuredContent ?? "{ value: params.value }";
  const content = options.content ?? "params.value";

  return `${options.leadingComment ? `${options.leadingComment}\n` : ""}import { tool, toolResult } from "sidecar-ai";

${params}

export default tool({
  name: "${options.name ?? "Diagnostic Tool"}",
  description: "${options.description ?? "Use this when checking Sidecar diagnostics."}",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false
  },
  ${options.extraProperties ?? ""}
  execute(${executeParams}) {
    return toolResult({
      structuredContent: ${structuredContent},
      content: ${content}
    });
  }
});
`;
}

/** Writes a fixture file after creating its parent directories. */
async function writeFixture(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

/** Extracts stable diagnostic codes from a diagnostics list. */
function codes(diagnostics: { code: string }[]): string[] {
  return diagnostics.map((diagnostic) => diagnostic.code);
}
