/** Static diagnostics for Sidecar projects. */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { JsonSchema } from "@sidecar-ai/core";
import type {
  SidecarCompilerConfig,
  SidecarPromptManifestEntry,
  SidecarResourceManifestEntry,
  SidecarToolManifestEntry,
} from "./types.js";

/** Diagnostic severity surfaced by the CLI and future editor integrations. */
export type DiagnosticSeverity = "warning" | "error";

/** Stable diagnostic emitted for a concrete project source location. */
export type SidecarDiagnostic = {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  filePath: string;
  line: number;
  column: number;
  hint?: string;
};

/** Collects project-level warnings that do not block compilation by default. */
export async function collectProjectDiagnostics(
  rootDir: string,
  input: SidecarToolManifestEntry[] | {
    tools: SidecarToolManifestEntry[];
    resources?: SidecarResourceManifestEntry[];
    prompts?: SidecarPromptManifestEntry[];
    config?: SidecarCompilerConfig;
  },
): Promise<SidecarDiagnostic[]> {
  const diagnostics: SidecarDiagnostic[] = [];
  const tools = Array.isArray(input) ? input : input.tools;
  const resources = Array.isArray(input) ? [] : input.resources ?? [];
  const prompts = Array.isArray(input) ? [] : input.prompts ?? [];
  const config = Array.isArray(input) ? undefined : input.config;
  const hasAuthConfig = existsSync(path.join(rootDir, "auth.ts"));
  const hasOpenAiAppsSdkUi = canResolveOpenAiAppsSdkUi(rootDir);

  for (const entry of tools) {
    const toolPath = path.join(rootDir, entry.sourceFile);
    const toolSource = await readFile(toolPath, "utf8");
    diagnostics.push(...diagnoseToolSource(rootDir, entry, toolSource, hasAuthConfig));

    if (entry.widget) {
      const widgetPath = path.join(rootDir, entry.widget.sourceFile);
      const widgetSource = await readFile(widgetPath, "utf8");
      diagnostics.push(...diagnoseWidgetSource(rootDir, entry, widgetSource, hasOpenAiAppsSdkUi));
    }
  }

  for (const entry of resources) {
    const resourcePath = path.join(rootDir, entry.sourceFile);
    const resourceSource = await readFile(resourcePath, "utf8");
    diagnostics.push(...diagnoseResourceSource(entry, resourceSource));
  }

  for (const entry of prompts) {
    const promptPath = path.join(rootDir, entry.sourceFile);
    const promptSource = await readFile(promptPath, "utf8");
    diagnostics.push(...diagnosePromptSource(entry, promptSource));
  }

  if (config) {
    diagnostics.push(...diagnoseCapabilities(config, resources));
  }

  return diagnostics;
}

/** Formats diagnostics in a TypeScript-style shape understood by many editors. */
export function formatDiagnostic(diagnostic: SidecarDiagnostic): string {
  const location = `${diagnostic.filePath}:${diagnostic.line}:${diagnostic.column}`;
  const hint = diagnostic.hint ? `\n  hint: ${diagnostic.hint}` : "";
  return `${location} - ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}${hint}`;
}

/** Emits warnings for one reserved `tool.ts` file. */
function diagnoseToolSource(
  rootDir: string,
  entry: SidecarToolManifestEntry,
  source: string,
  hasAuthConfig: boolean,
): SidecarDiagnostic[] {
  const diagnostics: SidecarDiagnostic[] = [];
  const toolLocation = locate(source, "tool({");

  if (!entry.description.trim().startsWith("Use this when")) {
    diagnostics.push({
      severity: "warning",
      code: "SIDECAR_METADATA_DESCRIPTION",
      message: `Tool "${entry.id}" description should start with "Use this when..." for better model routing.`,
      filePath: entry.sourceFile,
      ...toolLocation,
      hint: "Keep the first sentence specific and include explicit disallowed cases when useful.",
    });
  }

  for (const key of ["readOnlyHint", "destructiveHint", "openWorldHint"] as const) {
    if (!(key in (entry.annotations ?? {}))) {
      diagnostics.push({
        severity: "warning",
        code: "SIDECAR_TOOL_ANNOTATION",
        message: `Tool "${entry.id}" should explicitly declare annotations.${key}.`,
        filePath: entry.sourceFile,
        ...toolLocation,
        hint: "Hosts use these hints to frame approval and safety UX; Sidecar applies conservative defaults only as a fallback.",
      });
    }
  }

  if (/auth\s*:/.test(source) && !hasAuthConfig && !isIgnored(source, "SIDECAR_AUTH_MISSING_CONFIG")) {
    diagnostics.push({
      severity: "warning",
      code: "SIDECAR_AUTH_MISSING_CONFIG",
      message: `Tool "${entry.id}" declares auth but the project has no reserved auth.ts file.`,
      filePath: entry.sourceFile,
      ...locate(source, "auth"),
      hint: "Add auth.ts at the project root or mark the tool auth policy as public.",
    });
  }

  if (!returnsToolResult(source) && !isIgnored(source, "SIDECAR_TOOL_RESULT_REQUIRED")) {
    diagnostics.push({
      severity: "warning",
      code: "SIDECAR_TOOL_RESULT_REQUIRED",
      message: `Tool "${entry.id}" should return toolResult(...) from execute.`,
      filePath: entry.sourceFile,
      ...locate(source, "execute"),
      hint: "The runtime rejects plain objects so content, structuredContent, and meta always map cleanly to MCP result channels.",
    });
  }

  if (/["']openai\//.test(source) && !/@sidecar-ai\/openai/.test(source) && !isIgnored(source, "SIDECAR_OPENAI_MAGIC_META")) {
    diagnostics.push({
      severity: "warning",
      code: "SIDECAR_OPENAI_MAGIC_META",
      message: `Tool "${entry.id}" uses raw ChatGPT metadata strings.`,
      filePath: entry.sourceFile,
      ...locate(source, "openai/"),
      hint: "Use @sidecar-ai/openai helpers or the typed hosts.chatgpt field so platform metadata stays typed.",
    });
  }

  for (const parameterName of missingParameterDescriptions(entry.inputSchema)) {
    diagnostics.push({
      severity: "warning",
      code: "SIDECAR_PARAM_DESCRIPTION",
      message: `Parameter "${parameterName}" on tool "${entry.id}" is missing a JSDoc/schema description.`,
      filePath: entry.sourceFile,
      ...locate(source, parameterName),
      hint: "Add a JSDoc comment to the TypeScript field or provide a schema description.",
    });
  }

  if (looksLikeKnowledgeTool(entry) && !hasCompanyKnowledgeShape(entry.inputSchema) && !isIgnored(source, "SIDECAR_COMPANY_KNOWLEDGE_SHAPE")) {
    diagnostics.push({
      severity: "warning",
      code: "SIDECAR_COMPANY_KNOWLEDGE_SHAPE",
      message: `Tool "${entry.id}" looks like a search/fetch knowledge tool but does not use the expected simple input shape.`,
      filePath: entry.sourceFile,
      ...toolLocation,
      hint: "Use a string query for search tools or a string id/url for fetch tools, or add // sidecar-ignore SIDECAR_COMPANY_KNOWLEDGE_SHAPE.",
    });
  }

  return diagnostics.filter((diagnostic) => !isIgnored(source, diagnostic.code));
}

/** Emits warnings for one sibling `widget.tsx` file. */
function diagnoseWidgetSource(
  _rootDir: string,
  entry: SidecarToolManifestEntry,
  source: string,
  hasOpenAiAppsSdkUi: boolean,
): SidecarDiagnostic[] {
  const diagnostics: SidecarDiagnostic[] = [];
  const widgetFile = entry.widget?.sourceFile;
  if (!widgetFile) {
    return diagnostics;
  }

  if (/window\s*\.\s*openai|\(\s*window\s+as\s+[^)]*\)\s*\.\s*openai/.test(source) && !isIgnored(source, "SIDECAR_OPENAI_RAW_BRIDGE")) {
    diagnostics.push({
      severity: "warning",
      code: "SIDECAR_OPENAI_RAW_BRIDGE",
      message: `Widget for "${entry.id}" reads window.openai directly.`,
      filePath: widgetFile,
      ...locate(source, "openai"),
      hint: "Use @sidecar-ai/openai runtime helpers in ChatGPT-only widgets, or @sidecar-ai/native/@sidecar-ai/client for portable behavior.",
    });
  }

  if (entry.widget?.variant !== "openai" && /@sidecar-ai\/openai/.test(source) && !/@sidecar-ai\/native/.test(source) && !isIgnored(source, "SIDECAR_OPENAI_FALLBACK")) {
    diagnostics.push({
      severity: "warning",
      code: "SIDECAR_OPENAI_FALLBACK",
      message: `Widget for "${entry.id}" imports @sidecar-ai/openai without a portable fallback.`,
      filePath: widgetFile,
      ...locate(source, "@sidecar-ai/openai"),
      hint: "Prefer @sidecar-ai/native for user-facing behavior and reserve @sidecar-ai/openai for typed metadata or explicit ChatGPT-only code paths.",
    });
  }

  if (entry.widget?.variant !== "openai" && /@sidecar-ai\/openai\/components/.test(source) && !isIgnored(source, "SIDECAR_OPENAI_COMPONENT_CROSS_HOST")) {
    diagnostics.push({
      severity: "warning",
      code: "SIDECAR_OPENAI_COMPONENT_CROSS_HOST",
      message: `Widget for "${entry.id}" imports ChatGPT-only components.`,
      filePath: widgetFile,
      ...locate(source, "@sidecar-ai/openai/components"),
      hint: "Use @sidecar-ai/native for portable primitives. Keep @sidecar-ai/openai/components for widgets intentionally targeted to ChatGPT.",
    });
  }

  if (/@sidecar-ai\/openai\/components/.test(source) && !hasOpenAiAppsSdkUi && !isIgnored(source, "SIDECAR_OPENAI_UI_SDK_MISSING")) {
    diagnostics.push({
      severity: "error",
      code: "SIDECAR_OPENAI_UI_SDK_MISSING",
      message: `Widget for "${entry.id}" imports @sidecar-ai/openai/components but @openai/apps-sdk-ui is not installed.`,
      filePath: widgetFile,
      ...locate(source, "@sidecar-ai/openai/components"),
      hint: "Install it with: npm install @openai/apps-sdk-ui",
    });
  }

  if (entry.widget?.variant !== "anthropic" && /@sidecar-ai\/anthropic\/components/.test(source) && !isIgnored(source, "SIDECAR_ANTHROPIC_COMPONENT_CROSS_HOST")) {
    diagnostics.push({
      severity: "warning",
      code: "SIDECAR_ANTHROPIC_COMPONENT_CROSS_HOST",
      message: `Widget for "${entry.id}" imports Claude-only components.`,
      filePath: widgetFile,
      ...locate(source, "@sidecar-ai/anthropic/components"),
      hint: "Use @sidecar-ai/native for portable primitives. Keep @sidecar-ai/anthropic/components for widgets intentionally targeted to Claude.",
    });
  }

  if (/\bPopover\b/.test(source) && /@sidecar-ai\/native/.test(source) && !isIgnored(source, "SIDECAR_NATIVE_NON_PORTABLE_COMPONENT")) {
    diagnostics.push({
      severity: "warning",
      code: "SIDECAR_NATIVE_NON_PORTABLE_COMPONENT",
      message: `Widget for "${entry.id}" appears to expect a native Popover.`,
      filePath: widgetFile,
      ...locate(source, "Popover"),
      hint: "Popover is host-specific because Claude inline apps discourage clipped overlay UI. Use @sidecar-ai/openai/components for ChatGPT-only popovers.",
    });
  }

  return diagnostics.filter((diagnostic) => !isIgnored(source, diagnostic.code));
}

/** Emits warnings for one reserved `resource.ts` file. */
function diagnoseResourceSource(
  entry: SidecarResourceManifestEntry,
  source: string,
): SidecarDiagnostic[] {
  const diagnostics: SidecarDiagnostic[] = [];
  if (!returnsResourceResult(source) && !isIgnored(source, "SIDECAR_RESOURCE_RESULT_REQUIRED")) {
    diagnostics.push({
      severity: "warning",
      code: "SIDECAR_RESOURCE_RESULT_REQUIRED",
      message: `Resource "${entry.uri}" should return resourceResult(...) from read.`,
      filePath: entry.sourceFile,
      ...locate(source, "read"),
      hint: "The runtime rejects plain objects so text/blob content maps cleanly to MCP resource contents.",
    });
  }
  return diagnostics.filter((diagnostic) => !isIgnored(source, diagnostic.code));
}

/** Emits warnings for one reserved `prompt.ts` file. */
function diagnosePromptSource(
  entry: SidecarPromptManifestEntry,
  source: string,
): SidecarDiagnostic[] {
  const diagnostics: SidecarDiagnostic[] = [];
  if (!source.includes("run") && !isIgnored(source, "SIDECAR_PROMPT_RUN_REQUIRED")) {
    diagnostics.push({
      severity: "warning",
      code: "SIDECAR_PROMPT_RUN_REQUIRED",
      message: `Prompt "${entry.name}" should include a run method.`,
      filePath: entry.sourceFile,
      ...locate(source, "prompt({"),
      hint: "Prompt run methods return a string for the common case or MCP prompt messages for advanced cases.",
    });
  }
  return diagnostics.filter((diagnostic) => !isIgnored(source, diagnostic.code));
}

/** Emits build-time errors when config claims unsupported capability wiring. */
function diagnoseCapabilities(
  config: SidecarCompilerConfig,
  resources: SidecarResourceManifestEntry[],
): SidecarDiagnostic[] {
  const diagnostics: SidecarDiagnostic[] = [];
  if (!config.resources.subscribe && resources.some((entry) => entry.subscribe)) {
    const entry = resources.find((resource) => resource.subscribe);
    if (entry) {
      diagnostics.push({
        severity: "error",
        code: "SIDECAR_RESOURCE_SUBSCRIBE_DISABLED",
        message: `Resource "${entry.uri}" sets subscribe: true but sidecar.config.ts does not enable resources.subscribe.`,
        filePath: entry.sourceFile,
        line: 1,
        column: 1,
        hint: "Add resources: { subscribe: true } to sidecar.config.ts or remove subscribe: true from this resource.",
      });
    }
  }
  return diagnostics;
}

/** Returns true when the source visibly returns the standardized result helper. */
function returnsToolResult(source: string): boolean {
  return /\breturn\s+toolResult(?:\.\w+)?\s*\(/.test(source);
}

/** Returns true when the source visibly returns the standardized resource helper. */
function returnsResourceResult(source: string): boolean {
  return /\breturn\s+resourceResult(?:\.\w+)?\s*\(/.test(source);
}

/** Finds required parameters without model-facing descriptions. */
function missingParameterDescriptions(schema: JsonSchema): string[] {
  const properties = schema.properties ?? {};
  return Object.entries(properties)
    .filter(([, value]) => !value.description?.trim())
    .map(([key]) => key);
}

/** Returns true for tools named like knowledge search/fetch operations. */
function looksLikeKnowledgeTool(entry: SidecarToolManifestEntry): boolean {
  const text = `${entry.id} ${entry.name}`.toLowerCase();
  return /\b(search|fetch)\b/.test(text) || /(^|[._-])(search|fetch)([._-]|$)/.test(text);
}

/** Checks the minimum predictable shape Sidecar expects for knowledge tools. */
function hasCompanyKnowledgeShape(schema: JsonSchema): boolean {
  const properties = schema.properties ?? {};
  const query = properties.query;
  const url = properties.url;
  const id = properties.id;
  return query?.type === "string" || url?.type === "string" || id?.type === "string";
}

/** Returns true when the official OpenAI Apps UI SDK is resolvable from the app root. */
function canResolveOpenAiAppsSdkUi(rootDir: string): boolean {
  try {
    createRequire(path.join(rootDir, "package.json")).resolve("@openai/apps-sdk-ui/css");
    return true;
  } catch {
    return false;
  }
}

/** Locates text within a source file using 1-based editor coordinates. */
function locate(source: string, needle: string): { line: number; column: number } {
  const index = Math.max(0, source.indexOf(needle));
  const prefix = source.slice(0, index);
  const lines = prefix.split("\n");
  return {
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  };
}

/** Allows authors to silence a warning with a visible source comment. */
function isIgnored(source: string, code: string): boolean {
  return source.includes(`sidecar-ignore ${code}`) || source.includes(`sidecar-ignore all`);
}
