/** Widget discovery and HTML bundling. */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build as esbuild, type BuildOptions, type Loader, type Plugin } from "esbuild";
import postcss from "postcss";
import {
  Node,
  SyntaxKind,
  type ObjectLiteralExpression,
  type SourceFile,
} from "ts-morph";
import type { ChatGptWidgetOptions, ToolWidgetOptions, WidgetBuildConfig, WidgetBundlerHook } from "@sidecar-ai/core";
import { resolveDefaultExportCall, unwrapExpression } from "./ast.js";
import { CompilerError } from "./errors.js";
import type { SidecarSourceVariant, SidecarTarget, SidecarToolManifestEntry, SidecarWidgetManifestEntry } from "./types.js";
import { escapeHtml, safePathSegment, toImportSpecifier } from "./utils.js";

const CLAUDE_FONT_RESOURCE_DOMAIN = "https://assets.claude.ai";

/** Bundles every discovered `widget.tsx` into a content-hashed HTML resource. */
export async function buildWidgets(
  rootDir: string,
  outDir: string,
  tools: SidecarToolManifestEntry[],
  config: WidgetBuildConfig | undefined = undefined,
): Promise<void> {
  const widgets = tools.filter(
    (
      entry,
    ): entry is SidecarToolManifestEntry & {
      widget: SidecarWidgetManifestEntry;
    } => Boolean(entry.widget),
  );
  if (!widgets.length) {
    return;
  }

  const cacheDir = path.join(rootDir, ".sidecar", "cache", "widgets");
  await mkdir(cacheDir, { recursive: true });
  const appStyle = await prepareAppStyle(rootDir, cacheDir);
  const configure = await loadWidgetBundlerHook(rootDir, cacheDir, config?.configure);

  for (const entry of widgets) {
    const sourceFile = path.join(rootDir, entry.widget.sourceFile);
    const safeId = safePathSegment(entry.id);
    const entryFile = path.join(cacheDir, `${safeId}.entry.tsx`);
    const importPath = toImportSpecifier(path.dirname(entryFile), sourceFile);

    await writeFile(
      entryFile,
      `import React from "react";
import { createRoot } from "react-dom/client";
import { SidecarWidgetRoot } from "@sidecar-ai/react";
import "@sidecar-ai/native/styles.css";
${appStyle ? `import ${JSON.stringify(toImportSpecifier(path.dirname(entryFile), appStyle))};` : ""}
import Component from ${JSON.stringify(importPath)};

createRoot(document.getElementById("root")!).render(
  React.createElement(SidecarWidgetRoot, null, React.createElement(Component))
);
`,
    );

    const baseOptions = enforceWidgetBuildInvariants({
      absWorkingDir: rootDir,
      alias: devSidecarBundleAliases(rootDir),
      bundle: true,
      entryPoints: [entryFile],
      format: "iife",
      jsx: "automatic",
      minify: false,
      nodePaths: [
        path.join(rootDir, "node_modules"),
        path.join(process.cwd(), "node_modules"),
      ],
      outfile: "widget.js",
      platform: "browser",
      sourcemap: false,
      write: false,
    });
    const staticOptions = widgetBuildOptionsFromConfig(rootDir, config);
    const configuredOptions = configure
      ? await configureWidgetBuild(configure, {
          rootDir,
          outDir,
          entryFile,
          widget: {
            toolId: entry.id,
            toolName: entry.name,
            target: entry.target,
            sourceFile: entry.widget.sourceFile,
          },
          esbuildOptions: mergeWidgetBuildOptions(baseOptions, staticOptions),
        })
      : undefined;
    const bundled = await esbuild(enforceWidgetBuildInvariants(
      mergeWidgetBuildOptions(baseOptions, staticOptions, configuredOptions),
      { rootDir, entryFile },
    ));

    const outputFiles = bundled.outputFiles ?? [];
    const javascript = outputFiles.find((file) => file.path.endsWith(".js"))?.text ?? "";
    const css = outputFiles
      .filter((file) => file.path.endsWith(".css"))
      .map((file) => file.text)
      .join("\n");
    const html = renderWidgetHtml(entry.name, javascript, css);
    const hash = createHash("sha256").update(html).digest("hex").slice(0, 12);
    const outputDir = path.join(outDir, "public", "widgets", safeId);
    const outputFile = path.join(outputDir, `widget.${hash}.html`);
    const resourceUri = `ui://${safeId}/widget.${hash}.html`;

    await mkdir(outputDir, { recursive: true });
    await writeFile(outputFile, html);

    entry.widget.resourceUri = resourceUri;
    entry.widget.resourceMeta = widgetResourceMeta(entry.widget.options, entry.target);
    entry.widget.outputFile = path.relative(outDir, outputFile);
    entry.descriptor._meta = mergeWidgetMeta(entry.descriptor._meta, widgetMeta(resourceUri, entry.widget.options, entry.target));
  }
}

/** Converts static config into esbuild option extensions. */
function widgetBuildOptionsFromConfig(
  rootDir: string,
  config: WidgetBuildConfig | undefined,
): BuildOptions | undefined {
  const esbuildConfig = config?.esbuild;
  if (!esbuildConfig) {
    return undefined;
  }

  return {
    alias: normalizeAliases(rootDir, esbuildConfig.alias),
    conditions: esbuildConfig.conditions,
    define: esbuildConfig.define,
    external: esbuildConfig.external,
    jsx: esbuildConfig.jsx,
    jsxImportSource: esbuildConfig.jsxImportSource,
    loader: esbuildConfig.loader as Record<string, Loader> | undefined,
    mainFields: esbuildConfig.mainFields,
  };
}

/** Loads a project-level widget bundler hook from TS or JS. */
async function loadWidgetBundlerHook(
  rootDir: string,
  cacheDir: string,
  hookPath: string | undefined,
): Promise<WidgetBundlerHook<BuildOptions> | undefined> {
  if (!hookPath) {
    return undefined;
  }

  const sourcePath = path.resolve(rootDir, hookPath);
  const relative = path.relative(rootDir, sourcePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Widget bundler hook must stay inside the project root: ${hookPath}`);
  }
  if (!existsSync(sourcePath)) {
    throw new Error(`Widget bundler hook not found: ${hookPath}`);
  }

  const outputFile = path.join(cacheDir, `widget-bundler.${contentHash(hookPath)}.mjs`);
  await esbuild({
    absWorkingDir: rootDir,
    alias: devSidecarBundleAliases(rootDir),
    bundle: true,
    entryPoints: [sourcePath],
    format: "esm",
    nodePaths: [
      path.join(rootDir, "node_modules"),
      path.join(process.cwd(), "node_modules"),
    ],
    outfile: outputFile,
    packages: "external",
    platform: "node",
    target: "node20",
  });

  const module = (await import(`${pathToFileURL(outputFile).href}?t=${Date.now()}`)) as {
    default?: unknown;
  };
  if (typeof module.default !== "function") {
    throw new Error(`Widget bundler hook must default-export a function: ${hookPath}`);
  }

  return module.default as WidgetBundlerHook<BuildOptions>;
}

/** Runs the project hook and normalizes its supported return shapes. */
async function configureWidgetBuild(
  hook: WidgetBundlerHook<BuildOptions>,
  input: Parameters<WidgetBundlerHook<BuildOptions>>[0],
): Promise<BuildOptions | undefined> {
  const result = await hook(input);
  if (!result) {
    return undefined;
  }
  if (typeof result === "object" && "esbuildOptions" in result) {
    return result.esbuildOptions;
  }
  return result as BuildOptions;
}

/** Merges esbuild options while preserving additive fields. */
function mergeWidgetBuildOptions(
  ...options: Array<BuildOptions | undefined>
): BuildOptions {
  const merged: BuildOptions = {};
  for (const option of options) {
    if (!option) {
      continue;
    }

    const previousAlias = merged.alias;
    const previousDefine = merged.define;
    const previousLoader = merged.loader;
    const previousExternal = merged.external;
    const previousNodePaths = merged.nodePaths;
    const previousPlugins = merged.plugins;
    Object.assign(merged, option);
    merged.alias = { ...(previousAlias ?? {}), ...(option.alias ?? {}) };
    merged.define = { ...(previousDefine ?? {}), ...(option.define ?? {}) };
    merged.loader = { ...(previousLoader ?? {}), ...(option.loader ?? {}) };
    merged.external = uniqueStrings([...(previousExternal ?? []), ...(option.external ?? [])]);
    merged.nodePaths = uniqueStrings([...(previousNodePaths ?? []), ...(option.nodePaths ?? [])]);
    merged.plugins = [...(previousPlugins ?? []), ...(option.plugins ?? [])] as Plugin[];
  }
  return merged;
}

/** Re-applies Sidecar-owned esbuild invariants after project extensions. */
function enforceWidgetBuildInvariants(
  options: BuildOptions,
  required?: { rootDir: string; entryFile: string },
): BuildOptions {
  return {
    ...options,
    absWorkingDir: required?.rootDir ?? options.absWorkingDir,
    bundle: true,
    entryPoints: required ? [required.entryFile] : options.entryPoints,
    format: "iife",
    outfile: "widget.js",
    platform: "browser",
    write: false,
  };
}

/** Resolves relative alias replacements from the app root for predictable builds. */
function normalizeAliases(
  rootDir: string,
  aliases: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!aliases) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(aliases).map(([key, value]) => [
      key,
      value.startsWith(".") ? path.resolve(rootDir, value) : value,
    ]),
  );
}

/** Deduplicates esbuild string-array options. */
function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

/** Creates a short stable hash for cache file names. */
function contentHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

/** Provides source aliases when bundling repo-local examples before dist exists. */
function devSidecarBundleAliases(rootDir: string): Record<string, string> | undefined {
  const repoRoot = findSidecarRepoRoot(rootDir) ?? findSidecarRepoRoot(process.cwd());
  if (!repoRoot) {
    return undefined;
  }
  const reactEntry = path.join(repoRoot, "packages", "react", "src", "index.ts");
  if (!existsSync(reactEntry)) {
    return undefined;
  }

  return {
    "sidecar-ai": path.join(repoRoot, "packages", "sidecar-ai", "src", "index.ts"),
    "@sidecar-ai/client": path.join(repoRoot, "packages", "client", "src", "index.ts"),
    "@sidecar-ai/core": path.join(repoRoot, "packages", "core", "src", "index.ts"),
    "@sidecar-ai/react": reactEntry,
    "@sidecar-ai/native": path.join(repoRoot, "packages", "native", "src", "index.ts"),
    "@sidecar-ai/native/components": path.join(repoRoot, "packages", "native", "src", "components", "index.tsx"),
    "@sidecar-ai/native/styles.css": path.join(repoRoot, "packages", "native", "src", "styles.css"),
  };
}

/** Finds the repository root for source aliases used by local workspace tests. */
function findSidecarRepoRoot(startDir: string): string | undefined {
  let current = path.resolve(startDir);
  while (true) {
    if (existsSync(path.join(current, "packages", "core", "src", "index.ts"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

/** Copies and optionally processes root `style.css` for widget builds. */
async function prepareAppStyle(rootDir: string, cacheDir: string): Promise<string | undefined> {
  const sourceFile = path.join(rootDir, "style.css");
  if (!existsSync(sourceFile)) {
    return undefined;
  }

  const source = await readFile(sourceFile, "utf8");
  const css = await processAppStyle(source, sourceFile);
  const outputFile = path.join(cacheDir, "style.css");
  await writeFile(outputFile, css);
  return outputFile;
}

/** Runs Tailwind/PostCSS only when the app stylesheet needs it. */
async function processAppStyle(source: string, from: string): Promise<string> {
  if (!needsPostcss(source)) {
    return source;
  }

  const cssSource = source
    .replace(/@import\s+["']tailwindcss["'];?/g, "@tailwind utilities;")
    .replace(/@import\s+["']@openai\/apps-sdk-ui\/css["'];?/g, "");
  const plugins = [];
  if (cssSource.includes("@tailwind")) {
    const tailwind = await import("@tailwindcss/postcss");
    plugins.push(tailwind.default({ base: path.dirname(from) }));
  }

  const autoprefixer = await import("autoprefixer");
  plugins.push(autoprefixer.default());

  const result = await postcss(plugins).process(cssSource, {
    from,
    map: false,
  });
  return result.css;
}

/** Returns true when CSS contains framework directives that esbuild does not own. */
function needsPostcss(source: string): boolean {
  return /@import\s+["']tailwindcss["']|@tailwind|@source|@theme|@plugin/.test(source);
}

/** Finds a sibling `widget.tsx` for a tool file. */
export function findWidget(
  rootDir: string,
  toolFile: string,
  id: string,
  target: SidecarTarget = "mcp",
  toolVariant: SidecarSourceVariant = "shared",
): SidecarWidgetManifestEntry | undefined {
  const selected = selectWidgetFile(path.dirname(toolFile), target, toolVariant);
  if (!selected) {
    return undefined;
  }

  const safeId = safePathSegment(id);
  return {
    sourceFile: path.relative(rootDir, selected.filePath),
    variant: selected.variant,
    resourceUri: `ui://${safeId}/widget.html`,
  };
}

/** Extracts `widget({ ... }, Component)` metadata from a widget source file. */
export function readWidgetOptions(
  sourceFile: SourceFile,
): ToolWidgetOptions | undefined {
  const definition = findWidgetDefinition(sourceFile);
  if (!definition) {
    return undefined;
  }

  const options: ToolWidgetOptions = {};
  const description = readStringProperty(definition, "description");
  const prefersBorder = readBooleanProperty(definition, "prefersBorder");
  const csp = readWidgetCsp(definition);
  const permissions = readWidgetPermissions(definition);
  const chatgpt = readChatGptWidgetOptions(definition);
  const domain = readStringProperty(definition, "domain");

  if (description) options.description = description;
  if (prefersBorder !== undefined) options.prefersBorder = prefersBorder;
  if (domain) options.domain = domain;
  if (csp) options.csp = csp;
  if (permissions) options.permissions = permissions;
  if (chatgpt) options.hosts = { chatgpt };

  return Object.keys(options).length ? options : undefined;
}

/** Builds standard tool-to-widget and ChatGPT-compatible metadata for a descriptor. */
export function widgetMeta(
  resourceUri: string,
  options: ToolWidgetOptions = {},
  target: SidecarTarget = "mcp",
): Record<string, unknown> {
  const chatgptCsp = {
    connect_domains: options.csp?.connectDomains ? [...options.csp.connectDomains] : [],
    resource_domains: options.csp?.resourceDomains ? [...options.csp.resourceDomains] : [],
    frame_domains: options.csp?.frameDomains ? [...options.csp.frameDomains] : undefined,
    redirect_domains: options.hosts?.chatgpt?.redirectDomains
      ? [...options.hosts.chatgpt.redirectDomains]
      : undefined,
  };

  const standard = {
    ui: {
      resourceUri,
    },
  };

  if (target !== "chatgpt") {
    return standard;
  }

  return {
    ...standard,
    "openai/outputTemplate": resourceUri,
    "openai/widgetDescription": options.description,
    "openai/widgetDomain": options.hosts?.chatgpt?.domain,
    "openai/widgetCSP": stripUndefined(chatgptCsp),
  };
}

/** Builds MCP Apps metadata for the `ui://` resource content. */
export function widgetResourceMeta(
  options: ToolWidgetOptions = {},
  target: SidecarTarget = "mcp",
): Record<string, unknown> | undefined {
  const csp = stripUndefined({
    connectDomains: options.csp?.connectDomains ? [...options.csp.connectDomains] : [],
    resourceDomains: widgetResourceDomains(options, target),
    frameDomains: options.csp?.frameDomains ? [...options.csp.frameDomains] : undefined,
    baseUriDomains: options.csp?.baseUriDomains ? [...options.csp.baseUriDomains] : undefined,
  });
  const permissions = widgetPermissionsMeta(options);
  const ui = stripUndefined({
    csp,
    permissions,
    domain: options.domain ?? (target === "chatgpt" ? options.hosts?.chatgpt?.domain : undefined),
    prefersBorder: options.prefersBorder,
  });

  return Object.keys(ui).length ? { ui } : undefined;
}

/** Adds Claude's documented font origin when building Claude-targeted widgets. */
function widgetResourceDomains(
  options: ToolWidgetOptions,
  target: SidecarTarget,
): string[] {
  const domains = [...(options.csp?.resourceDomains ?? [])];
  if (target === "claude" && !domains.includes(CLAUDE_FONT_RESOURCE_DOMAIN)) {
    domains.push(CLAUDE_FONT_RESOURCE_DOMAIN);
  }
  return domains;
}

/** Locates the default-exported widget helper call when a widget uses one. */
function findWidgetDefinition(
  sourceFile: SourceFile,
): ObjectLiteralExpression | undefined {
  const call = resolveDefaultExportCall(sourceFile, "widget");
  if (!call) {
    return undefined;
  }

  const definition = unwrapExpression(call.getArguments()[0]);
  if (!definition || !Node.isObjectLiteralExpression(definition)) {
    throw new CompilerError(
      sourceFile,
      "widget(...) must receive its metadata object as the first argument.",
    );
  }

  return definition;
}

/** Reads standard widget CSP options. */
function readWidgetCsp(
  definition: ObjectLiteralExpression,
): ToolWidgetOptions["csp"] | undefined {
  const initializer = readObjectProperty(definition, "csp");
  if (!initializer) {
    return undefined;
  }

  const csp = {
    connectDomains: readStringArrayProperty(initializer, "connectDomains"),
    resourceDomains: readStringArrayProperty(initializer, "resourceDomains"),
    frameDomains: readStringArrayProperty(initializer, "frameDomains"),
    baseUriDomains: readStringArrayProperty(initializer, "baseUriDomains"),
  };
  return stripUndefined(csp);
}

/** Reads standard MCP Apps permission requests. */
function readWidgetPermissions(
  definition: ObjectLiteralExpression,
): ToolWidgetOptions["permissions"] | undefined {
  const initializer = readObjectProperty(definition, "permissions");
  if (!initializer) {
    return undefined;
  }

  const permissions = {
    camera: readBooleanProperty(initializer, "camera"),
    microphone: readBooleanProperty(initializer, "microphone"),
    geolocation: readBooleanProperty(initializer, "geolocation"),
    clipboardWrite: readBooleanProperty(initializer, "clipboardWrite"),
  };
  return stripUndefined(permissions);
}

/** Converts boolean permission flags into the standard empty-object shape. */
function widgetPermissionsMeta(options: ToolWidgetOptions): Record<string, unknown> | undefined {
  const permissions = options.permissions;
  if (!permissions) {
    return undefined;
  }

  const meta = stripUndefined({
    camera: permissions.camera ? {} : undefined,
    microphone: permissions.microphone ? {} : undefined,
    geolocation: permissions.geolocation ? {} : undefined,
    clipboardWrite: permissions.clipboardWrite ? {} : undefined,
  });
  return Object.keys(meta).length ? meta : undefined;
}

/** Reads ChatGPT-only widget compatibility options. */
function readChatGptWidgetOptions(
  definition: ObjectLiteralExpression,
): ChatGptWidgetOptions | undefined {
  const hosts = readObjectProperty(definition, "hosts");
  const chatgpt = hosts ? readObjectProperty(hosts, "chatgpt") : undefined;
  if (!chatgpt) {
    return undefined;
  }

  const options = {
    domain: readStringProperty(chatgpt, "domain"),
    redirectDomains: readStringArrayProperty(chatgpt, "redirectDomains"),
  };
  return stripUndefined(options);
}

/** Reads a nested object literal property, unwrapping TS-only expressions. */
function readObjectProperty(
  definition: ObjectLiteralExpression,
  propertyName: string,
): ObjectLiteralExpression | undefined {
  const property = definition.getProperty(propertyName);
  if (!property || !Node.isPropertyAssignment(property)) {
    return undefined;
  }

  const initializer = unwrapExpression(property.getInitializer());
  return initializer && Node.isObjectLiteralExpression(initializer)
    ? initializer
    : undefined;
}

/** Reads a string literal property from an object literal. */
function readStringProperty(
  definition: ObjectLiteralExpression,
  propertyName: string,
): string | undefined {
  const property = definition.getProperty(propertyName);
  if (!property || !Node.isPropertyAssignment(property)) {
    return undefined;
  }

  const initializer = unwrapExpression(property.getInitializer());
  return initializer && Node.isStringLiteral(initializer)
    ? initializer.getLiteralText()
    : undefined;
}

/** Reads a boolean literal property from an object literal. */
function readBooleanProperty(
  definition: ObjectLiteralExpression,
  propertyName: string,
): boolean | undefined {
  const property = definition.getProperty(propertyName);
  if (!property || !Node.isPropertyAssignment(property)) {
    return undefined;
  }

  const initializer = unwrapExpression(property.getInitializer());
  if (!initializer) {
    return undefined;
  }

  if (initializer.getKind() === SyntaxKind.TrueKeyword) {
    return true;
  }
  if (initializer.getKind() === SyntaxKind.FalseKeyword) {
    return false;
  }
  return undefined;
}

/** Reads a string literal array property from an object literal. */
function readStringArrayProperty(
  definition: ObjectLiteralExpression,
  propertyName: string,
): string[] | undefined {
  const property = definition.getProperty(propertyName);
  if (!property || !Node.isPropertyAssignment(property)) {
    return undefined;
  }

  const initializer = unwrapExpression(property.getInitializer());
  if (!initializer || !Node.isArrayLiteralExpression(initializer)) {
    return undefined;
  }

  return initializer
    .getElements()
    .filter(Node.isStringLiteral)
    .map((element) => element.getLiteralText());
}

/** Selects the widget source for a target, preferring platform overrides. */
function selectWidgetFile(
  directory: string,
  target: SidecarTarget,
  toolVariant: SidecarSourceVariant,
): { filePath: string; variant: SidecarSourceVariant } | undefined {
  if (toolVariant === "openai") {
    const filePath = path.join(directory, "widget.openai.tsx");
    return existsSync(filePath) ? { filePath, variant: "openai" } : undefined;
  }

  if (toolVariant === "anthropic") {
    const filePath = path.join(directory, "widget.anthropic.tsx");
    return existsSync(filePath) ? { filePath, variant: "anthropic" } : undefined;
  }

  const candidates =
    target === "chatgpt" || target === "claude" || target === "mcp"
      ? [{ name: "widget.tsx", variant: "shared" as const }]
      : [];

  for (const candidate of candidates) {
    const filePath = path.join(directory, candidate.name);
    if (existsSync(filePath)) {
      return { filePath, variant: candidate.variant };
    }
  }

  return undefined;
}

/** Merges widget metadata into existing descriptor metadata without losing `ui`. */
export function mergeWidgetMeta(
  existing: Record<string, unknown> | undefined,
  widget: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(existing ?? {}) };
  for (const [key, value] of Object.entries(widget)) {
    if (key === "ui" && isRecord(value) && isRecord(merged.ui)) {
      merged.ui = { ...merged.ui, ...value };
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

/** Wraps bundled JavaScript in the minimal transparent widget document. */
function renderWidgetHtml(title: string, javascript: string, css = ""): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: light dark; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      html, body, #root { min-height: 100%; margin: 0; background: transparent; }
      body { color: CanvasText; }
      * { box-sizing: border-box; }
      ${css}
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>${javascript}</script>
  </body>
</html>
`;
}

/** Returns true for metadata objects that can be shallow-merged. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** Drops undefined keys from emitted metadata objects. */
function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}
