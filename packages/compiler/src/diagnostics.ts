/** Static diagnostics for Sidecar projects. */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { JsonSchema } from "@sidecar/core";
import type { SidecarToolManifestEntry } from "./types.js";

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
  tools: SidecarToolManifestEntry[],
): Promise<SidecarDiagnostic[]> {
  const diagnostics: SidecarDiagnostic[] = [];
  const hasAuthConfig = existsSync(path.join(rootDir, "auth.ts"));

  for (const entry of tools) {
    const toolPath = path.join(rootDir, entry.sourceFile);
    const toolSource = await readFile(toolPath, "utf8");
    diagnostics.push(...diagnoseToolSource(rootDir, entry, toolSource, hasAuthConfig));

    if (entry.widget) {
      const widgetPath = path.join(rootDir, entry.widget.sourceFile);
      const widgetSource = await readFile(widgetPath, "utf8");
      diagnostics.push(...diagnoseWidgetSource(rootDir, entry, widgetSource));
    }
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

  if (/["']openai\//.test(source) && !/@sidecar\/openai/.test(source) && !isIgnored(source, "SIDECAR_OPENAI_MAGIC_META")) {
    diagnostics.push({
      severity: "warning",
      code: "SIDECAR_OPENAI_MAGIC_META",
      message: `Tool "${entry.id}" uses raw ChatGPT metadata strings.`,
      filePath: entry.sourceFile,
      ...locate(source, "openai/"),
      hint: "Use @sidecar/openai helpers or the typed hosts.chatgpt field so platform metadata stays typed.",
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
      hint: "Use @sidecar/native or @sidecar/client so ChatGPT-only capabilities degrade cleanly in Claude/Codex hosts.",
    });
  }

  if (/@sidecar\/openai/.test(source) && !/@sidecar\/native/.test(source) && !isIgnored(source, "SIDECAR_OPENAI_FALLBACK")) {
    diagnostics.push({
      severity: "warning",
      code: "SIDECAR_OPENAI_FALLBACK",
      message: `Widget for "${entry.id}" imports @sidecar/openai without a portable fallback.`,
      filePath: widgetFile,
      ...locate(source, "@sidecar/openai"),
      hint: "Prefer @sidecar/native for user-facing behavior and reserve @sidecar/openai for typed metadata or explicit ChatGPT-only code paths.",
    });
  }

  if (/@sidecar\/openai\/components/.test(source) && !isIgnored(source, "SIDECAR_OPENAI_COMPONENT_CROSS_HOST")) {
    diagnostics.push({
      severity: "warning",
      code: "SIDECAR_OPENAI_COMPONENT_CROSS_HOST",
      message: `Widget for "${entry.id}" imports ChatGPT-only components.`,
      filePath: widgetFile,
      ...locate(source, "@sidecar/openai/components"),
      hint: "Use @sidecar/native for portable primitives. Keep @sidecar/openai/components for widgets intentionally targeted to ChatGPT.",
    });
  }

  if (/@sidecar\/anthropic\/components/.test(source) && !isIgnored(source, "SIDECAR_ANTHROPIC_COMPONENT_CROSS_HOST")) {
    diagnostics.push({
      severity: "warning",
      code: "SIDECAR_ANTHROPIC_COMPONENT_CROSS_HOST",
      message: `Widget for "${entry.id}" imports Claude-only components.`,
      filePath: widgetFile,
      ...locate(source, "@sidecar/anthropic/components"),
      hint: "Use @sidecar/native for portable primitives. Keep @sidecar/anthropic/components for widgets intentionally targeted to Claude.",
    });
  }

  if (/\bPopover\b/.test(source) && /@sidecar\/native/.test(source) && !isIgnored(source, "SIDECAR_NATIVE_NON_PORTABLE_COMPONENT")) {
    diagnostics.push({
      severity: "warning",
      code: "SIDECAR_NATIVE_NON_PORTABLE_COMPONENT",
      message: `Widget for "${entry.id}" appears to expect a native Popover.`,
      filePath: widgetFile,
      ...locate(source, "Popover"),
      hint: "Popover is host-specific because Claude inline apps discourage clipped overlay UI. Use @sidecar/openai/components for ChatGPT-only popovers.",
    });
  }

  return diagnostics.filter((diagnostic) => !isIgnored(source, diagnostic.code));
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
