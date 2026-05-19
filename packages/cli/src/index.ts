#!/usr/bin/env node
/**
 * Sidecar command-line interface.
 *
 * The CLI currently provides the vertical slice needed for local development:
 * static inspection, build output generation, and a dev MCP server.
 */
import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cwd, exit, stdin, stdout } from "node:process";
import { tsImport } from "tsx/esm/api";
import { isSidecarAuth, type SidecarAuth } from "@sidecar-ai/auth";
import {
  analyzeProjectTools,
  analyzeProjectConfig,
  analyzeProjectPrompts,
  analyzeProjectResources,
  buildProject,
  collectProjectDiagnostics,
  formatDiagnostic,
  SERVER_ENTRYPOINT,
  VERCEL_ENTRYPOINT,
  type SidecarDiagnostic,
  type SidecarHost,
  type SidecarManifest,
  type SidecarTarget,
  type SidecarToolManifestEntry,
} from "@sidecar-ai/compiler";
import { isSidecarPrompt, isSidecarResource, isSidecarTool, MCP_APP_RESOURCE_MIME_TYPE, type SidecarConfig } from "@sidecar-ai/core";
import { createSidecarHttpServer, isSidecarProxy, type LoadedPrompt, type LoadedResource, type LoadedTool, type SidecarProxy } from "@sidecar-ai/server";
import { startTunnel, validateTunnelEndpoint, type TunnelProvider, type TunnelSession } from "./tunnel.js";

type Command = "build" | "check" | "dev" | "inspect" | "preview" | "help";

/** Dispatches the requested CLI command. */
export async function main(argv: string[]): Promise<void> {
  const command = (argv[2] ?? "help") as Command;
  const rootDir = readOption(argv, "--cwd") ?? cwd();

  switch (command) {
    case "build": {
      const target = readOptionalTarget(argv);
      const host = readOptionalHost(argv) ?? detectHostFromEnvironment();
      const outDir = readOption(argv, "--out");
      const plugins = readOptionalPlugins(argv);
      const strict = argv.includes("--strict");
      const manifest = await buildProject({ rootDir, host, outDir, plugins, strict, target });
      const resolvedOutDir = outDir ?? manifest.config.build.outDir ?? defaultBuildOutDir(manifest.host, manifest.target);
      printDiagnostics(manifest.diagnostics ?? []);
      if (strict && manifest.diagnostics?.length) {
        exit(1);
      }
      console.log(
        `Built ${manifest.tools.length} ${manifest.target} tool${manifest.tools.length === 1 ? "" : "s"}, ` +
          `${manifest.resources.length} resource${manifest.resources.length === 1 ? "" : "s"}, and ` +
          `${manifest.prompts.length} prompt${manifest.prompts.length === 1 ? "" : "s"} to ${resolvedOutDir}.`,
      );
      console.log(`Host runtime: ${manifest.host}`);
      if (manifest.host === "vercel") {
        console.log(`Vercel MCP function: ${path.join(resolvedOutDir, VERCEL_ENTRYPOINT)}`);
      } else {
        console.log(`Hostable MCP server: ${path.join(resolvedOutDir, SERVER_ENTRYPOINT)}`);
      }
      if (plugins ?? manifest.config.build.plugins) {
        console.log("Built claude-plugin package.");
      }
      return;
    }

    case "check": {
      const target = readTarget(argv);
      const config = analyzeProjectConfig(rootDir);
      const tools = await analyzeProjectTools(rootDir, { target });
      const resources = await analyzeProjectResources(rootDir);
      const prompts = await analyzeProjectPrompts(rootDir);
      const diagnostics = await collectProjectDiagnostics(rootDir, {
        tools,
        resources,
        prompts,
        config,
      });
      printDiagnostics(diagnostics);
      if (diagnostics.some((diagnostic) => diagnostic.severity === "error") || (argv.includes("--strict") && diagnostics.length > 0)) {
        exit(1);
      }
      if (!diagnostics.length) {
        console.log("No Sidecar diagnostics.");
      }
      return;
    }

    case "dev": {
      const port = Number(readOption(argv, "--port") ?? "3001");
      const target = readTarget(argv);
      const tunnelProvider = readTunnelProvider(argv);
      const outDir = `.sidecar/dev/${target}`;
      const loadedAuth = await loadRuntimeAuth(rootDir);
      const runtimeConfig = await loadRuntimeConfig(rootDir);
      const proxy = await loadRuntimeProxy(rootDir);
      const runtimeToolEntries = await analyzeProjectTools(rootDir, { target });
      const runtimeTools = await loadRuntimeTools(rootDir, runtimeToolEntries);
      const manifest = await buildProject({ rootDir, outDir, target });
      printDiagnostics(manifest.diagnostics ?? []);
      const tools = attachBuiltToolDescriptors(runtimeTools, manifest);
      let tunnel: TunnelSession | undefined;
      if (tunnelProvider) {
        tunnel = await startTunnel({ provider: tunnelProvider, port, path: "/mcp" });
        process.env.SIDECAR_MCP_URL = tunnel.mcpUrl;
      }

      const auth = loadedAuth && tunnel ? loadedAuth.withResource(tunnel.mcpUrl) : loadedAuth;
      const resources = await loadResources(rootDir, outDir, manifest);
      const prompts = await loadRuntimePrompts(rootDir, manifest);
      const server = createSidecarHttpServer({
        name: "sidecar-dev",
        version: "0.0.0-dev",
        path: "/mcp",
        auth,
        proxy,
        tools,
        resources,
        prompts,
        capabilities: {
          tools: runtimeConfig?.tools ?? manifest.config.tools,
          resources: runtimeConfig?.resources ?? manifest.config.resources,
          prompts: runtimeConfig?.prompts ?? manifest.config.prompts,
        },
        pagination: runtimeConfig?.pagination ?? {
          pageSize: manifest.config.pagination.pageSize,
        },
      });

      let listening = false;
      try {
        await listenOnLocalhost(server, port);
        listening = true;
        if (tunnel) {
          await validateTunnelEndpoint({
            mcpUrl: tunnel.mcpUrl,
            auth: Boolean(auth),
          });
        }

        console.log(`MCP running on Streamable HTTP (${target}) at http://127.0.0.1:${port}/mcp`);
        console.log(`Loaded ${tools.length} tool${tools.length === 1 ? "" : "s"}, ${resources.length} resource${resources.length === 1 ? "" : "s"}, and ${prompts.length} prompt${prompts.length === 1 ? "" : "s"}.`);
        if (tunnel) {
          console.log(`HTTPS tunnel (${tunnel.provider}) validated: ${tunnel.mcpUrl}`);
          console.log("Use this HTTPS MCP URL in ChatGPT, Claude, or a Claude plugin install.");
        }
      } catch (error) {
        tunnel?.close();
        if (listening) {
          await closeServer(server);
        }
        throw error;
      }

      const shutdown = () => {
        tunnel?.close();
        server.close(() => exit(0));
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
      return;
    }

    case "inspect": {
      const target = readTarget(argv);
      const tools = await analyzeProjectTools(rootDir, { target });
      if (!tools.length) {
        console.log("No Sidecar tools found.");
        return;
      }

      for (const tool of tools) {
        console.log(`${tool.id} — ${tool.name} (${tool.variant}, ${tool.target})`);
        console.log(`  ${tool.description}`);
        console.log(`  source: ${tool.sourceFile}`);
      }
      return;
    }

    case "preview": {
      if (argv[3] !== "components") {
        throw new Error("Only `sidecar preview components` is supported right now.");
      }

      await previewComponents({
        rootDir,
        host: readOption(argv, "--host") ?? "chatgpt",
        port: Number(readOption(argv, "--port") ?? "3102"),
        compare: readOption(argv, "--compare") ?? "native,openai",
        componentSet: readPreviewComponentSet(readOption(argv, "--components")),
        themes: readPreviewThemes(readOption(argv, "--theme")),
        approve: !argv.includes("--no-approve"),
      });
      return;
    }

    case "help":
    default:
      console.log(`Sidecar

Usage:
  sidecar build [--cwd <dir>] [--target mcp|chatgpt|claude] [--host node|vercel] [--out <dir>] [--plugins|--no-plugins] [--strict]
  sidecar check [--cwd <dir>] [--target mcp|chatgpt|claude] [--strict]
  sidecar dev [--cwd <dir>] [--target mcp|chatgpt|claude] [--port <port>] [--tunnel [cloudflared|wrangler]]
  sidecar inspect [--cwd <dir>] [--target mcp|chatgpt|claude]
  sidecar preview components [--cwd <dir>] [--host chatgpt|claude|generic] [--compare native,openai] [--components representative|all] [--theme light|dark|both] [--port <port>] [--no-approve]
`);
  }
}

/** Returns the conventional output directory for a host target. */
function defaultBuildOutDir(host: SidecarHost, target: SidecarTarget): string {
  if (host === "vercel") {
    return ".vercel/output";
  }
  return `out/${target}`;
}

/** Reads and validates the build target profile. */
function readTarget(argv: string[]): SidecarTarget {
  const target = readOptionalTarget(argv) ?? "mcp";
  return target;
}

/** Reads an optional build target profile. */
function readOptionalTarget(argv: string[]): SidecarTarget | undefined {
  const target = readOption(argv, "--target");
  if (!target) {
    return undefined;
  }
  if (target === "mcp" || target === "chatgpt" || target === "claude") {
    return target;
  }
  throw new Error(`Unsupported Sidecar target "${target}". Expected mcp, chatgpt, or claude.`);
}

/** Reads and validates the host runtime artifact profile. */
function readHost(argv: string[]): SidecarHost {
  const host = readOptionalHost(argv) ?? detectHostFromEnvironment() ?? "node";
  return host;
}

/** Reads an optional host runtime artifact profile. */
function readOptionalHost(argv: string[]): SidecarHost | undefined {
  const host = readOption(argv, "--host");
  if (!host) {
    return undefined;
  }
  if (host === "node" || host === "vercel") {
    return host;
  }
  throw new Error(`Unsupported Sidecar host "${host}". Expected node or vercel.`);
}

/** Infers a hosting artifact when a deployment platform exposes a reliable build env. */
function detectHostFromEnvironment(): SidecarHost | undefined {
  if (process.env.VERCEL === "1") {
    return "vercel";
  }
  return undefined;
}

/** Reads an optional plugin build override. */
function readOptionalPlugins(argv: string[]): boolean | undefined {
  if (argv.includes("--plugins")) {
    return true;
  }
  if (argv.includes("--no-plugins")) {
    return false;
  }
  return undefined;
}

/** Options for the component parity preview command. */
type ComponentPreviewOptions = {
  rootDir: string;
  host: string;
  port: number;
  compare: string;
  componentSet: ComponentPreviewSet;
  themes: ComponentPreviewTheme[];
  approve: boolean;
};

/** Component inventory rendered in the preview matrix. */
type ComponentPreviewSet = "representative" | "all";

/** Theme variants rendered by the preview matrix. */
type ComponentPreviewTheme = "light" | "dark";

/** Starts a component matrix preview and optionally records human approval. */
async function previewComponents(options: ComponentPreviewOptions): Promise<void> {
  const cliDir = path.dirname(fileURLToPath(import.meta.url));
  const css = await readFile(path.join(cliDir, "../../native/src/styles.css"), "utf8")
    .catch(() => readFile(path.join(process.cwd(), "packages/native/src/styles.css"), "utf8"))
    .catch(() => "");
  const html = renderComponentPreviewHtml(
    options.host,
    options.compare,
    css,
    options.themes,
    options.componentSet,
  );
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
  });

  await new Promise<void>((resolve) => {
    server.listen(options.port, "127.0.0.1", resolve);
  });

  const url = `http://127.0.0.1:${options.port}`;
  console.log(`Sidecar component preview running at ${url}`);
  console.log(`Compare set: ${options.compare}`);
  console.log(`Component set: ${options.componentSet}`);
  console.log(`Themes: ${options.themes.join(", ")}`);

  if (!options.approve || !stdin.isTTY) {
    return;
  }

  const answer = await askYesNo(
    `Do the shared primitives look equivalent for ${options.host}? [y/N] `,
  );
  if (answer) {
    await writeComponentApproval(options.rootDir, {
      host: options.host,
      compare: options.compare.split(",").map((entry) => entry.trim()).filter(Boolean),
      approvedAt: new Date().toISOString(),
      components: previewComponentNames(options.componentSet),
    });
    console.log("Recorded component parity approval.");
  } else {
    console.log("No approval recorded.");
  }

  server.close();
}

/** Component parity approval receipt written by the preview command. */
type ComponentApproval = {
  host: string;
  compare: string[];
  approvedAt: string;
  components: string[];
};

/** Writes a local receipt for maintainers reviewing host recipe parity. */
async function writeComponentApproval(rootDir: string, approval: ComponentApproval): Promise<void> {
  const dir = path.join(rootDir, ".sidecar", "approvals");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, `components.${approval.host}.json`),
    `${JSON.stringify(approval, null, 2)}\n`,
  );
}

/** Asks a yes/no question on the command line. */
async function askYesNo(question: string): Promise<boolean> {
  const readline = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await readline.question(question);
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  } finally {
    readline.close();
  }
}

/** Renders the static preview matrix used for human parity checks. */
export function renderComponentPreviewHtml(
  host: string,
  compare: string,
  css: string,
  themes: readonly ComponentPreviewTheme[],
  componentSet: ComponentPreviewSet,
): string {
  const themeFrames = themes
    .map((theme) =>
      `<section class="theme-panel">
        <div class="theme-label">${escapeHtml(theme)}</div>
        <iframe title="${escapeHtml(theme)} component preview" srcdoc="${escapeHtml(renderComponentPreviewFrame(host, compare, css, theme, componentSet))}"></iframe>
      </section>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sidecar component preview</title>
    <style>
      body { background: #f4f4f5; color: #18181b; font: 14px/1.4 ui-sans-serif, -apple-system, system-ui, "Segoe UI", sans-serif; margin: 0; padding: 18px; }
      .preview-shell { display: grid; gap: 18px; }
      .theme-panel { display: grid; gap: 8px; }
      .theme-label { font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
      iframe { background: transparent; border: 1px solid rgb(0 0 0 / 12%); border-radius: 10px; height: 82vh; min-height: 680px; width: 100%; }
    </style>
  </head>
  <body>
    <main class="preview-shell">${themeFrames}</main>
  </body>
</html>`;
}

/** Renders one isolated theme frame so root host/theme selectors work normally. */
export function renderComponentPreviewFrame(
  host: string,
  compare: string,
  css: string,
  theme: ComponentPreviewTheme,
  componentSet: ComponentPreviewSet,
): string {
  const columns = compare.split(",").map((entry) => entry.trim()).filter(Boolean);
  const cells = columns
    .map((column) => renderPreviewColumn(column, host, componentSet))
    .join("");

  return `<!doctype html>
<html lang="en" data-sidecar-host="${escapeHtml(host)}" data-sidecar-theme="${theme}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sidecar component preview</title>
    <style>
      ${css}
      html, body { background: var(--sc-surface); }
      body { padding: 24px; }
      .preview-grid { display: grid; gap: 20px; grid-template-columns: repeat(${Math.max(columns.length, 1)}, minmax(240px, 1fr)); }
      .preview-column { display: flex; flex-direction: column; gap: 14px; }
      .preview-group { border-bottom: 1px solid var(--sc-border); display: grid; gap: 10px; padding-bottom: 14px; }
      .preview-group:last-child { border-bottom: 0; }
      .component-label { color: var(--sc-text-muted); font: 600 11px/1.2 var(--sc-font-sans); text-transform: uppercase; }
      .preview-row { align-items: start; display: grid; gap: 8px; }
      .preview-label { color: var(--sc-text-muted); font: 600 12px/1.2 var(--sc-font-sans); text-transform: uppercase; }
    </style>
  </head>
  <body>
    <main class="preview-grid">${cells}</main>
  </body>
</html>`;
}

/** Renders one package/recipe column in the preview matrix. */
function renderPreviewColumn(column: string, host: string, componentSet: ComponentPreviewSet): string {
  const recipe = previewRecipe(column, host);
  const groups = componentSet === "all"
    ? renderAllPreviewGroups(recipe)
    : renderRepresentativePreviewGroups(recipe);
  return `<section class="preview-column">
    <div class="preview-label">${escapeHtml(column)}</div>
    ${groups}
  </section>`;
}

/** Maps preview columns to the recipe they exercise. */
function previewRecipe(column: string, host: string): string {
  switch (column) {
    case "native":
      return "auto";
    case "native-chatgpt":
    case "openai":
      return "chatgpt";
    case "native-claude":
    case "anthropic":
      return "claude";
    default:
      return host;
  }
}

/** Renders the default representative component set. */
function renderRepresentativePreviewGroups(recipe: string): string {
  return [
    previewGroup("Buttons", buttonsPreview(recipe)),
    previewGroup("Fields", fieldsPreview(recipe)),
    previewGroup("Choices", choicesPreview(recipe)),
    previewGroup("Feedback", feedbackPreview(recipe)),
    previewGroup("Loading", loadingPreview(recipe)),
  ].join("");
}

/** Renders the full native shared component set. */
function renderAllPreviewGroups(recipe: string): string {
  return [
    previewGroup("Text", textPreview(recipe)),
    previewGroup("Buttons", buttonsPreview(recipe)),
    previewGroup("Links", linksPreview(recipe)),
    previewGroup("Fields", fieldsPreview(recipe)),
    previewGroup("Choice Controls", choicesPreview(recipe)),
    previewGroup("Select", selectPreview(recipe)),
    previewGroup("Feedback", feedbackPreview(recipe)),
    previewGroup("Identity", identityPreview(recipe)),
    previewGroup("Empty State", emptyPreview(recipe)),
    previewGroup("Loading", loadingPreview(recipe)),
    previewGroup("Layout", layoutPreview(recipe)),
    previewGroup("Data", dataPreview(recipe)),
    previewGroup("Media", mediaPreview(recipe)),
  ].join("");
}

/** Wraps one preview group with a readable label. */
function previewGroup(label: string, body: string): string {
  return `<div class="preview-group"><div class="component-label">${escapeHtml(label)}</div>${body}</div>`;
}

/** Text and inline typography examples. */
function textPreview(recipe: string): string {
  return `<div class="preview-row">
    <h2 data-sc-component="heading" data-sc-level="2" data-sc-recipe="${recipe}">Heading</h2>
    <p data-sc-component="text" data-sc-recipe="${recipe}">Body text follows the active host typography.</p>
    <p data-sc-component="text" data-sc-tone="muted" data-sc-recipe="${recipe}">Muted supporting text</p>
    <code data-sc-component="code" data-sc-recipe="${recipe}">tool_result.id</code>
    <span data-sc-component="shimmer-text" data-sc-recipe="${recipe}">Shimmer text</span>
  </div>`;
}

/** Button examples. */
function buttonsPreview(recipe: string): string {
  return `<div class="preview-row">
    <button data-sc-component="button" data-sc-color="primary" data-sc-variant="solid" data-sc-size="md" data-sc-pill data-sc-recipe="${recipe}" type="button"><span data-sc-component="button-label">Primary</span></button>
    <button data-sc-component="button" data-sc-color="secondary" data-sc-variant="soft" data-sc-size="md" data-sc-pill data-sc-recipe="${recipe}" type="button"><span data-sc-component="button-label">Secondary</span></button>
    <button data-sc-component="button" data-sc-color="danger" data-sc-variant="outline" data-sc-size="md" data-sc-pill data-sc-recipe="${recipe}" type="button"><span data-sc-component="button-label">Danger</span></button>
    <button data-sc-component="button" data-sc-color="secondary" data-sc-variant="ghost" data-sc-size="md" data-sc-pill data-sc-recipe="${recipe}" type="button"><span data-sc-component="button-label">Ghost</span></button>
    <button data-sc-component="button" data-sc-color="primary" data-sc-variant="solid" data-sc-size="md" data-sc-pill data-sc-loading data-sc-recipe="${recipe}" type="button"><span data-sc-component="loading-indicator" data-sc-recipe="${recipe}" style="--sc-indicator-size: 1em;"></span><span data-sc-component="button-label">Loading</span></button>
  </div>`;
}

/** Link examples. */
function linksPreview(recipe: string): string {
  return `<div class="preview-row">
    <a data-sc-component="button" data-sc-color="primary" data-sc-variant="solid" data-sc-size="md" data-sc-pill data-sc-recipe="${recipe}" href="#"><span data-sc-component="button-label">ButtonLink</span></a>
    <a data-sc-component="text-link" data-sc-primary data-sc-underline data-sc-recipe="${recipe}" href="#">TextLink</a>
  </div>`;
}

/** Field examples. */
function fieldsPreview(recipe: string): string {
  return `<div class="preview-row">
    <div data-sc-component="form-field" data-sc-recipe="${recipe}">
      <label data-sc-component="field-label" data-sc-recipe="${recipe}">FormField label</label>
      <span data-sc-component="input-shell" data-sc-variant="outline" data-sc-size="md" data-sc-recipe="${recipe}"><input data-sc-component="input" value="Input" /></span>
      <p data-sc-component="field-description" data-sc-recipe="${recipe}">Field description</p>
    </div>
    <span data-sc-component="input-shell" data-sc-variant="soft" data-sc-size="md" data-sc-recipe="${recipe}"><span data-sc-component="input-adornment">$</span><input data-sc-component="input" value="Soft input" /></span>
    <textarea data-sc-component="textarea" data-sc-variant="outline" data-sc-size="md" data-sc-recipe="${recipe}">Textarea</textarea>
    <div data-sc-component="form-field" data-sc-invalid data-sc-recipe="${recipe}">
      <span data-sc-component="input-shell" data-sc-invalid data-sc-variant="outline" data-sc-size="md" data-sc-recipe="${recipe}"><input data-sc-component="input" value="Invalid" aria-invalid="true" /></span>
      <p data-sc-component="field-error" data-sc-recipe="${recipe}">Field error</p>
    </div>
  </div>`;
}

/** Choice-control examples. */
function choicesPreview(recipe: string): string {
  return `<div class="preview-row">
    <label data-sc-component="checkbox-label" data-sc-recipe="${recipe}"><button data-sc-component="checkbox" data-sc-checked data-sc-recipe="${recipe}" role="checkbox" aria-checked="true" type="button"></button><span>Checkbox</span></label>
    <label data-sc-component="switch-label" data-sc-recipe="${recipe}"><button data-sc-component="switch" data-sc-checked data-sc-recipe="${recipe}" role="switch" aria-checked="true" type="button"><span data-sc-component="switch-thumb"></span></button><span>Switch</span></label>
    <div data-sc-component="radio-group" data-sc-direction="row" data-sc-recipe="${recipe}" role="radiogroup">
      <button data-sc-component="radio-item" data-sc-checked data-sc-recipe="${recipe}" role="radio" aria-checked="true" type="button"><span data-sc-component="radio-indicator"></span><span data-sc-component="radio-label">List</span></button>
      <button data-sc-component="radio-item" data-sc-recipe="${recipe}" role="radio" aria-checked="false" type="button"><span data-sc-component="radio-indicator"></span><span data-sc-component="radio-label">Grid</span></button>
    </div>
    <div data-sc-component="segmented-control" data-sc-size="md" data-sc-recipe="${recipe}"><button data-sc-component="segmented-option" data-sc-selected type="button">List</button><button data-sc-component="segmented-option" type="button">Grid</button></div>
    <input data-sc-component="slider" data-sc-recipe="${recipe}" type="range" value="60" />
  </div>`;
}

/** Select examples. */
function selectPreview(recipe: string): string {
  return `<div class="preview-row">
    <span data-sc-component="select-control" data-sc-variant="outline" data-sc-size="md" data-sc-selected data-sc-recipe="${recipe}"><span data-sc-component="select-control-value">Selected option</span><span data-sc-component="select-dropdown-icon">▾</span></span>
    <div data-sc-component="select" data-sc-open data-sc-recipe="${recipe}">
      <span data-sc-component="select-control" data-sc-variant="outline" data-sc-size="md" data-sc-selected data-sc-recipe="${recipe}"><span data-sc-component="select-control-value">CSV</span><span data-sc-component="select-dropdown-icon">▾</span></span>
      <div data-sc-component="select-list" data-sc-recipe="${recipe}" role="listbox">
        <button data-sc-component="select-option" data-sc-selected role="option" aria-selected="true" type="button"><span data-sc-component="select-option-label">CSV</span><span data-sc-component="select-option-description">Comma-separated values</span></button>
        <button data-sc-component="select-option" role="option" aria-selected="false" type="button"><span data-sc-component="select-option-label">PDF</span><span data-sc-component="select-option-description">Portable document</span></button>
      </div>
    </div>
  </div>`;
}

/** Feedback examples. */
function feedbackPreview(recipe: string): string {
  return `<div class="preview-row">
    <div data-sc-component="alert" data-sc-color="info" data-sc-variant="soft" data-sc-recipe="${recipe}"><span data-sc-component="alert-indicator">•</span><div data-sc-component="alert-content"><div data-sc-component="alert-title">Alert</div><div data-sc-component="alert-description">Native recipe check</div></div></div>
    <span data-sc-component="badge" data-sc-color="success" data-sc-variant="soft" data-sc-size="sm" data-sc-recipe="${recipe}">Badge</span>
    <span data-sc-component="badge" data-sc-color="danger" data-sc-variant="outline" data-sc-size="md" data-sc-pill data-sc-recipe="${recipe}">Pill badge</span>
  </div>`;
}

/** Avatar and identity examples. */
function identityPreview(recipe: string): string {
  return `<div data-sc-component="avatar-group" data-sc-recipe="${recipe}">
    <span data-sc-component="avatar" data-sc-color="primary" data-sc-variant="solid" data-sc-recipe="${recipe}" style="--sc-avatar-size: 32px;">SD</span>
    <span data-sc-component="avatar" data-sc-color="secondary" data-sc-variant="soft" data-sc-recipe="${recipe}" style="--sc-avatar-size: 32px;">+3</span>
  </div>`;
}

/** Empty-message examples. */
function emptyPreview(recipe: string): string {
  return `<div data-sc-component="empty-message" data-sc-fill="static" data-sc-recipe="${recipe}">
    <div data-sc-component="empty-message-icon" data-sc-color="secondary" data-sc-size="md" data-sc-recipe="${recipe}">□</div>
    <div data-sc-component="empty-message-title" data-sc-color="secondary" data-sc-recipe="${recipe}">No results</div>
    <div data-sc-component="empty-message-description">Try another filter.</div>
    <div data-sc-component="empty-message-actions"><button data-sc-component="button" data-sc-color="secondary" data-sc-variant="soft" data-sc-size="sm" data-sc-pill data-sc-recipe="${recipe}" type="button"><span data-sc-component="button-label">Reset</span></button></div>
  </div>`;
}

/** Loading examples. */
function loadingPreview(recipe: string): string {
  return `<div class="preview-row">
    <div data-sc-component="loading-dots" data-sc-recipe="${recipe}"><span></span><span></span><span></span></div>
    <span data-sc-component="loading-indicator" data-sc-recipe="${recipe}" style="--sc-indicator-size: 24px;"></span>
    <span data-sc-component="circular-progress" data-sc-recipe="${recipe}" style="--sc-progress-size: 28px;"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="color-mix(in srgb, currentColor 18%, transparent)" stroke-width="2"></circle><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="62.8" stroke-dashoffset="18" stroke-linecap="round" transform="rotate(-90 12 12)"></circle></svg></span>
    <div data-sc-component="skeleton" data-sc-recipe="${recipe}" style="width: 100%; height: 24px;"></div>
  </div>`;
}

/** Layout primitive examples. */
function layoutPreview(recipe: string): string {
  return `<div data-sc-component="stack" data-sc-gap="sm" data-sc-recipe="${recipe}">
    <div data-sc-component="surface" data-sc-variant="card" data-sc-recipe="${recipe}"><p data-sc-component="text" data-sc-recipe="${recipe}">Card surface</p></div>
    <div data-sc-component="surface" data-sc-variant="inset" data-sc-recipe="${recipe}"><p data-sc-component="text" data-sc-recipe="${recipe}">Inset surface</p></div>
    <div data-sc-component="inline" data-sc-gap="sm" data-sc-recipe="${recipe}"><span data-sc-component="badge" data-sc-recipe="${recipe}">Inline</span><span data-sc-component="badge" data-sc-recipe="${recipe}">Row</span></div>
    <hr data-sc-component="divider" data-sc-recipe="${recipe}" />
    <div data-sc-component="tabs" data-sc-recipe="${recipe}"><div data-sc-component="segmented-control" data-sc-size="sm" data-sc-recipe="${recipe}"><button data-sc-component="segmented-option" data-sc-selected type="button">One</button><button data-sc-component="segmented-option" type="button">Two</button></div></div>
  </div>`;
}

/** Data display examples. */
function dataPreview(recipe: string): string {
  return `<div class="preview-row">
    <dl data-sc-component="key-value" data-sc-recipe="${recipe}">
      <div data-sc-component="key-value-row"><dt>Status</dt><dd>Ready</dd></div>
      <div data-sc-component="key-value-row"><dt>Target</dt><dd>ChatGPT</dd></div>
    </dl>
    <table data-sc-component="table" data-sc-recipe="${recipe}"><tbody><tr><th>Name</th><td>Sidecar</td></tr><tr><th>Version</th><td>alpha</td></tr></tbody></table>
    <progress data-sc-component="progress" data-sc-recipe="${recipe}" value="70" max="100"></progress>
  </div>`;
}

/** Media examples. */
function mediaPreview(recipe: string): string {
  return `<svg data-sc-component="image" data-sc-recipe="${recipe}" viewBox="0 0 320 120" role="img" aria-label="Preview image">
    <rect width="320" height="120" rx="12" fill="currentColor" opacity="0.08"></rect>
    <circle cx="64" cy="60" r="28" fill="currentColor" opacity="0.18"></circle>
    <rect x="112" y="42" width="150" height="12" rx="6" fill="currentColor" opacity="0.2"></rect>
    <rect x="112" y="66" width="104" height="10" rx="5" fill="currentColor" opacity="0.14"></rect>
  </svg>`;
}

/** Returns the components represented in a preview set. */
export function previewComponentNames(componentSet: ComponentPreviewSet): string[] {
  if (componentSet === "representative") {
    return [
      "Button",
      "Input",
      "SelectControl",
      "Checkbox",
      "Switch",
      "RadioGroup",
      "SegmentedControl",
      "Alert",
      "Badge",
      "Skeleton",
    ];
  }

  return [
    "Alert",
    "Avatar",
    "AvatarGroup",
    "Badge",
    "Button",
    "ButtonLink",
    "Checkbox",
    "CircularProgress",
    "Code",
    "CopyButton",
    "Divider",
    "EmptyMessage",
    "FieldDescription",
    "FieldError",
    "FieldLabel",
    "FormField",
    "Heading",
    "Image",
    "Inline",
    "Input",
    "KeyValue",
    "LoadingDots",
    "LoadingIndicator",
    "Progress",
    "RadioGroup",
    "SegmentedControl",
    "Select",
    "SelectControl",
    "ShimmerText",
    "Skeleton",
    "Slider",
    "Stack",
    "Surface",
    "Switch",
    "Table",
    "Tabs",
    "Text",
    "Textarea",
    "TextLink",
  ];
}

/** Parses the component inventory selected for the preview command. */
export function readPreviewComponentSet(value: string | undefined): ComponentPreviewSet {
  if (!value || value === "representative") {
    return "representative";
  }
  if (value === "all") {
    return value;
  }
  throw new Error(`Unsupported component preview set "${value}". Expected representative or all.`);
}

/** Parses the theme set selected for the preview command. */
export function readPreviewThemes(value: string | undefined): ComponentPreviewTheme[] {
  if (!value || value === "light") {
    return ["light"];
  }
  if (value === "dark") {
    return ["dark"];
  }
  if (value === "both") {
    return ["light", "dark"];
  }

  const themes = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (themes.every((theme): theme is ComponentPreviewTheme => theme === "light" || theme === "dark")) {
    return themes;
  }
  throw new Error(`Unsupported component preview theme "${value}". Expected light, dark, both, or a comma-separated light,dark list.`);
}

/** Escapes user-controlled strings before inserting them into preview HTML. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

/** Reads `--tunnel`, supporting either a bare flag or an explicit provider. */
function readTunnelProvider(argv: string[]): TunnelProvider | undefined {
  const index = argv.indexOf("--tunnel");
  if (index === -1) {
    return undefined;
  }

  const value = argv[index + 1];
  if (value === "cloudflared" || value === "wrangler") {
    return value;
  }
  return "auto";
}

/** Prints diagnostics in an editor-friendly file:line:column format. */
function printDiagnostics(diagnostics: SidecarDiagnostic[]): void {
  for (const diagnostic of diagnostics) {
    console.warn(formatDiagnostic(diagnostic));
  }
}

/** Loads `auth.ts` at runtime for the dev server when present. */
async function loadRuntimeAuth(rootDir: string): Promise<SidecarAuth | undefined> {
  const authPath = path.join(rootDir, "auth.ts");
  if (!existsSync(authPath)) {
    return undefined;
  }

  const parentURL = pathToFileURL(path.join(rootDir, "sidecar.config.ts")).href;
  const tsconfigPath = path.join(rootDir, "tsconfig.json");
  const tsconfig = existsSync(tsconfigPath) ? tsconfigPath : false;
  const module = (await tsImport(pathToFileURL(authPath).href, {
    parentURL,
    tsconfig
  })) as { default?: unknown };

  const defaultExport = unwrapRuntimeDefault(module.default);
  if (!isSidecarAuth(defaultExport)) {
    throw new Error("auth.ts must default-export auth({ ... }) from sidecar-ai.");
  }

  return defaultExport;
}

/** Loads `proxy.ts` at runtime for the dev server when present. */
async function loadRuntimeProxy(rootDir: string): Promise<SidecarProxy | undefined> {
  const proxyPath = path.join(rootDir, "proxy.ts");
  if (!existsSync(proxyPath)) {
    return undefined;
  }

  const parentURL = pathToFileURL(path.join(rootDir, "sidecar.config.ts")).href;
  const tsconfigPath = path.join(rootDir, "tsconfig.json");
  const tsconfig = existsSync(tsconfigPath) ? tsconfigPath : false;
  const module = (await tsImport(pathToFileURL(proxyPath).href, {
    parentURL,
    tsconfig
  })) as { default?: unknown };

  const defaultExport = unwrapRuntimeDefault(module.default);
  if (!isSidecarProxy(defaultExport)) {
    throw new Error("proxy.ts must default-export proxy({ ... }) from @sidecar-ai/server/proxy.");
  }

  return defaultExport;
}

/** Loads `sidecar.config.ts` at runtime so dev can honor function overrides. */
async function loadRuntimeConfig(rootDir: string): Promise<SidecarConfig | undefined> {
  const configPath = path.join(rootDir, "sidecar.config.ts");
  if (!existsSync(configPath)) {
    return undefined;
  }

  const parentURL = pathToFileURL(configPath).href;
  const tsconfigPath = path.join(rootDir, "tsconfig.json");
  const tsconfig = existsSync(tsconfigPath) ? tsconfigPath : false;
  const module = (await tsImport(pathToFileURL(configPath).href, {
    parentURL,
    tsconfig
  })) as { default?: unknown };

  const defaultExport = unwrapRuntimeDefault(module.default);
  if (!defaultExport || typeof defaultExport !== "object") {
    throw new Error("sidecar.config.ts must default-export defineConfig({ ... }) from sidecar-ai.");
  }

  return defaultExport as SidecarConfig;
}

/** Imports built-time discovered tools for the dev server. */
async function loadRuntimeTools(
  rootDir: string,
  entries: SidecarToolManifestEntry[],
): Promise<Array<LoadedTool & { sourceFile: string }>> {
  const parentURL = pathToFileURL(path.join(rootDir, "sidecar.config.ts")).href;
  const tsconfigPath = path.join(rootDir, "tsconfig.json");
  const tsconfig = existsSync(tsconfigPath) ? tsconfigPath : false;
  const loaded: Array<LoadedTool & { sourceFile: string }> = [];

  for (const entry of entries) {
    const sourcePath = path.join(rootDir, entry.sourceFile);
    const module = (await tsImport(pathToFileURL(sourcePath).href, {
      parentURL,
      tsconfig
    })) as { default?: unknown };

    const defaultExport = unwrapRuntimeDefault(module.default);
    if (!isSidecarTool(defaultExport)) {
      throw new Error(`${entry.sourceFile} did not default-export a Sidecar tool.`);
    }

    loaded.push({
      sourceFile: entry.sourceFile,
      tool: defaultExport,
      descriptor: entry.descriptor
    });
  }

  return loaded;
}

/** Reuses already-imported tool modules with descriptors updated by widget bundling. */
function attachBuiltToolDescriptors(
  loadedTools: Array<LoadedTool & { sourceFile: string }>,
  manifest: SidecarManifest,
): LoadedTool[] {
  const descriptorsBySource = new Map(
    manifest.tools.map((entry) => [entry.sourceFile, entry.descriptor]),
  );
  return loadedTools.map(({ sourceFile, tool, descriptor }) => ({
    tool,
    descriptor: descriptorsBySource.get(sourceFile) ?? descriptor,
  }));
}

/** Reads generated widget resources so the dev server can serve them through MCP. */
async function loadResources(rootDir: string, outDir: string, manifest: SidecarManifest): Promise<LoadedResource[]> {
  const resources: LoadedResource[] = [];
  for (const entry of manifest.tools) {
    if (!entry.widget?.outputFile) {
      continue;
    }

    const text = await readFile(path.join(rootDir, outDir, entry.widget.outputFile), "utf8");
    resources.push({
      uri: entry.widget.resourceUri,
      name: entry.name,
      description: entry.widget.options?.description,
      mimeType: MCP_APP_RESOURCE_MIME_TYPE,
      text,
      _meta: entry.widget.resourceMeta
    });
  }

  const parentURL = pathToFileURL(path.join(rootDir, "sidecar.config.ts")).href;
  const tsconfigPath = path.join(rootDir, "tsconfig.json");
  const tsconfig = existsSync(tsconfigPath) ? tsconfigPath : false;
  for (const entry of manifest.resources) {
    const sourcePath = path.join(rootDir, entry.sourceFile);
    const module = (await tsImport(pathToFileURL(sourcePath).href, {
      parentURL,
      tsconfig
    })) as { default?: unknown };

    const defaultExport = unwrapRuntimeDefault(module.default);
    if (!isSidecarResource(defaultExport)) {
      throw new Error(`${entry.sourceFile} did not default-export a Sidecar resource.`);
    }

    resources.push({
      uri: entry.uri,
      descriptor: entry.descriptor,
      resource: defaultExport,
    });
  }

  return resources;
}

/** Imports build-time discovered prompts for the dev server. */
async function loadRuntimePrompts(rootDir: string, manifest: SidecarManifest): Promise<LoadedPrompt[]> {
  const parentURL = pathToFileURL(path.join(rootDir, "sidecar.config.ts")).href;
  const tsconfigPath = path.join(rootDir, "tsconfig.json");
  const tsconfig = existsSync(tsconfigPath) ? tsconfigPath : false;
  const loaded: LoadedPrompt[] = [];

  for (const entry of manifest.prompts) {
    const sourcePath = path.join(rootDir, entry.sourceFile);
    const module = (await tsImport(pathToFileURL(sourcePath).href, {
      parentURL,
      tsconfig
    })) as { default?: unknown };

    const defaultExport = unwrapRuntimeDefault(module.default);
    if (!isSidecarPrompt(defaultExport)) {
      throw new Error(`${entry.sourceFile} did not default-export a Sidecar prompt.`);
    }

    loaded.push({
      prompt: defaultExport,
      descriptor: entry.descriptor,
    });
  }

  return loaded;
}

/** Normalizes default-export interop shapes produced by source TypeScript loaders. */
function unwrapRuntimeDefault(value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    "default" in value &&
    Object.keys(value).length === 1
  ) {
    return unwrapRuntimeDefault((value as { default: unknown }).default);
  }
  return value;
}

/** Starts the local dev server and resolves only once the port is bound. */
function listenOnLocalhost(
  server: ReturnType<typeof createSidecarHttpServer>,
  port: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      reject(error);
    };
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
}

/** Closes a dev server during startup failure cleanup. */
function closeServer(server: ReturnType<typeof createSidecarHttpServer>): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

/** Reads a simple `--name value` option from argv. */
function readOption(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return argv[index + 1];
}

/** Returns true when this module is being executed as the CLI entrypoint. */
function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }

  const entryPath = realpathSync.native(entry);
  return import.meta.url === pathToFileURL(entryPath).href;
}

if (isDirectRun()) {
  main(process.argv).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    exit(1);
  });
}
