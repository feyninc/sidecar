#!/usr/bin/env node
/**
 * Sidecar command-line interface.
 *
 * The CLI currently provides the vertical slice needed for local development:
 * static inspection, build output generation, and a dev MCP server.
 */
import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cwd, execPath, exit, stdin, stdout } from "node:process";
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
import {
  isSidecarPrompt,
  isSidecarRemote,
  isSidecarResource,
  isSidecarTool,
  MCP_APP_RESOURCE_MIME_TYPE,
  type RemoteExecutionDefinition,
  type SidecarConfig
} from "@sidecar-ai/core";
import { createSidecarHttpServer, isSidecarProxy, type LoadedPrompt, type LoadedResource, type LoadedTool, type SidecarProxy } from "@sidecar-ai/server";
import { startDevHarness, type DevHarnessDevice, type DevHarnessHost, type DevHarnessTheme } from "./dev-harness.js";
import { startTunnel, validateTunnelEndpoint, type TunnelProvider, type TunnelSession } from "./tunnel.js";

type Command = "build" | "check" | "component-preview" | "dev" | "inspect" | "preview" | "help";

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
      console.log(renderBuildUrlSummary({
        host: manifest.host,
        mcpPath: process.env.SIDECAR_MCP_PATH,
        publicMcpUrl: process.env.SIDECAR_MCP_URL,
        publicUrl: process.env.SIDECAR_PUBLIC_URL,
        port: process.env.SIDECAR_PORT ?? process.env.PORT,
      }));
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
      await loadProjectEnv(rootDir);
      const port = Number(readOption(argv, "--mcp-port") ?? readOption(argv, "--port") ?? "3101");
      const harnessPort = Number(readOption(argv, "--harness-port") ?? "3000");
      const target = readTarget(argv);
      const devHost = readDevHost(argv);
      const devTheme = readDevTheme(argv);
      const devDevice = readDevDevice(argv);
      const model = readOption(argv, "--model") ?? process.env.SIDECAR_DEV_MODEL ?? "gpt-4.1-mini";
      const tunnelProvider = readTunnelProvider(argv);
      const outDir = `.sidecar/dev/${target}`;
      const localMcpUrl = `http://127.0.0.1:${port}/mcp`;
      process.env.SIDECAR_MCP_URL = localMcpUrl;
      const manifest = await buildProject({ rootDir, outDir, target, host: "node" });
      printDiagnostics(manifest.diagnostics ?? []);
      let tunnel: TunnelSession | undefined;
      if (tunnelProvider) {
        tunnel = await startTunnel({ provider: tunnelProvider, port, path: "/mcp" });
        process.env.SIDECAR_MCP_URL = tunnel.mcpUrl;
      }

      const runtimeMcpUrl = tunnel?.mcpUrl ?? localMcpUrl;
      let mcpProcess: ChildProcess | undefined;
      let harness: Awaited<ReturnType<typeof startDevHarness>> | undefined;
      try {
        mcpProcess = await startBuiltMcpServer({
          rootDir,
          outDir,
          port,
          mcpUrl: runtimeMcpUrl,
        });
        if (tunnel) {
          await validateTunnelEndpoint({
            mcpUrl: tunnel.mcpUrl,
            auth: existsSync(path.join(rootDir, "auth.ts")),
          });
        }

        console.log(`MCP running on Streamable HTTP (${target}).`);
        console.log(`Loaded ${manifest.tools.length} tool${manifest.tools.length === 1 ? "" : "s"}, ${manifest.resources.length} resource${manifest.resources.length === 1 ? "" : "s"}, and ${manifest.prompts.length} prompt${manifest.prompts.length === 1 ? "" : "s"}.`);
        harness = await startDevHarness({
          rootDir,
          mcpUrl: localMcpUrl,
          host: devHost,
          theme: devTheme,
          device: devDevice,
          target,
          port: harnessPort,
          model,
          initialBearerToken: process.env.MCP_BEARER,
        });
        console.log(renderDevUrlSummary({
          localMcpUrl,
          runtimeMcpUrl,
          tunnelProvider: tunnel?.provider,
          harnessUrl: harness.url,
        }));
      } catch (error) {
        tunnel?.close();
        await harness?.close();
        await stopBuiltMcpServer(mcpProcess);
        throw error;
      }

      const shutdown = () => {
        tunnel?.close();
        void harness?.close()
          .then(() => stopBuiltMcpServer(mcpProcess))
          .finally(() => exit(0));
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
      await previewProject({
        rootDir,
        targets: readPreviewTargets(argv),
      });
      return;
    }

    case "component-preview": {
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
  sidecar dev [--cwd <dir>] [--target mcp|chatgpt|claude] [--port <mcp-port>] [--mcp-port <port>] [--harness-port <port>] [--host chatgpt|claude|generic] [--theme light|dark] [--device desktop|mobile] [--model <model>] [--tunnel [cloudflared|wrangler]]
  sidecar inspect [--cwd <dir>] [--target mcp|chatgpt|claude]
  sidecar preview [--cwd <dir>] [--target mcp|chatgpt|claude]
  sidecar component-preview [--cwd <dir>] [--host chatgpt|claude|generic] [--compare native,openai] [--components representative|all] [--theme light|dark|both] [--port <port>] [--no-approve]
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

/** Reads the initial simulated host for `sidecar dev`. */
function readDevHost(argv: string[]): DevHarnessHost {
  const host = readOption(argv, "--host") ?? "chatgpt";
  if (host === "chatgpt" || host === "claude" || host === "generic") {
    return host;
  }
  throw new Error(`Unsupported dev host "${host}". Expected chatgpt, claude, or generic.`);
}

/** Reads the initial simulated theme for `sidecar dev`. */
function readDevTheme(argv: string[]): DevHarnessTheme {
  const theme = readOption(argv, "--theme") ?? "light";
  if (theme === "light" || theme === "dark") {
    return theme;
  }
  throw new Error(`Unsupported dev theme "${theme}". Expected light or dark.`);
}

/** Reads the initial simulated device for `sidecar dev`. */
function readDevDevice(argv: string[]): DevHarnessDevice {
  const device = readOption(argv, "--device") ?? "desktop";
  if (device === "desktop" || device === "mobile") {
    return device;
  }
  throw new Error(`Unsupported dev device "${device}". Expected desktop or mobile.`);
}

/** Infers a hosting artifact when a deployment platform exposes a reliable build env. */
function detectHostFromEnvironment(): SidecarHost | undefined {
  if (process.env.VERCEL === "1") {
    return "vercel";
  }
  return undefined;
}

/** Loads project-local env files for development without overriding shell env. */
async function loadProjectEnv(rootDir: string): Promise<void> {
  for (const filename of [".env", ".env.local", ".envb"]) {
    const text = await readFile(path.join(rootDir, filename), "utf8").catch(() => undefined);
    if (!text) {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?\s*$/);
      if (!match) {
        continue;
      }
      const [, key, rawValue = ""] = match;
      if (!key || process.env[key] !== undefined) {
        continue;
      }
      process.env[key] = parseEnvValue(rawValue);
    }
  }
}

/** Parses one dotenv scalar value. */
function parseEnvValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).replace(/\\n/g, "\n");
  }
  return trimmed.replace(/\s+#.*$/, "");
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

/** Options for the project widget preview command. */
type ProjectPreviewOptions = {
  rootDir: string;
  targets: SidecarTarget[];
};

/** URL information printed after a build completes. */
export type BuildUrlSummaryOptions = {
  host: SidecarHost;
  mcpPath?: string;
  port?: string;
  publicMcpUrl?: string;
  publicUrl?: string;
};

/** URL information printed after `sidecar dev` starts. */
export type DevUrlSummaryOptions = {
  harnessUrl: string;
  localMcpUrl: string;
  runtimeMcpUrl: string;
  tunnelProvider?: TunnelProvider;
};

/** Built target output used by the project preview server. */
export type ProjectPreviewBuild = {
  target: SidecarTarget;
  outDir: string;
  manifest: SidecarManifest;
};

/** Renders build-time URL guidance without implying the artifact is already deployed. */
export function renderBuildUrlSummary(options: BuildUrlSummaryOptions): string {
  const mcpPath = options.mcpPath ?? "/mcp";
  const lines = ["Sidecar URLs:"];
  if (options.host === "vercel") {
    lines.push(`  Vercel MCP route: https://<project>.vercel.app${mcpPath}`);
  } else {
    lines.push(`  Local Node MCP: http://127.0.0.1:${options.port ?? "3101"}${mcpPath}`);
  }
  lines.push(`  Public MCP: ${options.publicMcpUrl ?? `set SIDECAR_MCP_URL=https://your-host.example.com${mcpPath}`}`);
  lines.push(`  Public base: ${options.publicUrl ?? "set SIDECAR_PUBLIC_URL=https://your-host.example.com when callbacks need a base URL"}`);
  return lines.join("\n");
}

/** Renders the URLs exposed by `sidecar dev`. */
export function renderDevUrlSummary(options: DevUrlSummaryOptions): string {
  const stateUrl = `${options.harnessUrl}/__sidecar/dev/state`;
  const lines = [
    "Sidecar URLs:",
    `  Local MCP: ${options.localMcpUrl}`,
    `  Dev harness: ${options.harnessUrl}`,
    `  Dev harness state: ${stateUrl}`,
  ];
  if (options.runtimeMcpUrl !== options.localMcpUrl) {
    lines.push(`  Public MCP (${options.tunnelProvider ?? "tunnel"}): ${options.runtimeMcpUrl}`);
    lines.push(`  ChatGPT/Claude connector URL: ${options.runtimeMcpUrl}`);
  } else {
    lines.push(`  Harness connector URL: ${options.localMcpUrl}`);
  }
  return lines.join("\n");
}

/** Starts the visual project widget catalog. */
async function previewProject(options: ProjectPreviewOptions): Promise<void> {
  const builds: ProjectPreviewBuild[] = [];
  for (const target of options.targets) {
    const outDir = `.sidecar/preview/${target}`;
    const manifest = await buildProject({ rootDir: options.rootDir, outDir, target });
    printDiagnostics(manifest.diagnostics ?? []);
    builds.push({ target, outDir, manifest });
  }

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(renderProjectPreviewHtml(builds));
        return;
      }

      if (url.pathname === "/widget") {
        const target = url.searchParams.get("target");
        const tool = url.searchParams.get("tool");
        const theme = url.searchParams.get("theme") === "dark" ? "dark" : "light";
        const build = builds.find((entry) => entry.target === target);
        const entry = build?.manifest.tools.find((item) => item.id === tool);
        if (!build || !entry?.widget?.outputFile) {
          response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          response.end("Widget not found.");
          return;
        }

        const html = await readFile(path.join(options.rootDir, build.outDir, entry.widget.outputFile), "utf8");
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(injectProjectPreviewBridge(html, entry, build.target, theme));
        return;
      }

      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found.");
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  const port = await listenOnAnyPort(server);
  const url = `http://127.0.0.1:${port}`;
  console.log(`Sidecar preview running at ${url}`);
  console.log(`Targets: ${options.targets.join(", ")}`);
  console.log("Press Ctrl+C to stop.");

  const shutdown = () => {
    server.close(() => exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

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

/** Renders the project widget catalog with one section per theme and one column per target. */
export function renderProjectPreviewHtml(builds: readonly ProjectPreviewBuild[]): string {
  const themes: ComponentPreviewTheme[] = ["light", "dark"];
  const sections = themes.map((theme) => renderProjectPreviewTheme(builds, theme)).join("");
  const toolCount = new Set(
    builds.flatMap((build) => build.manifest.tools.filter((tool) => tool.widget).map((tool) => tool.id)),
  ).size;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sidecar preview</title>
    <style>
      :root { color-scheme: light dark; }
      * { box-sizing: border-box; }
      body { background: #f4f4f5; color: #18181b; font: 14px/1.45 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; }
      header { align-items: baseline; background: rgb(255 255 255 / 92%); border-bottom: 1px solid rgb(0 0 0 / 10%); display: flex; gap: 14px; padding: 14px 18px; position: sticky; top: 0; z-index: 1; }
      h1 { font-size: 18px; margin: 0; }
      .summary { color: #5f5f66; }
      .theme-section { display: grid; gap: 12px; padding: 18px; }
      .theme-title { color: #3f3f46; font-size: 12px; font-weight: 800; letter-spacing: .05em; margin: 0; text-transform: uppercase; }
      .target-grid { align-items: start; display: grid; gap: 14px; grid-template-columns: repeat(${Math.max(builds.length, 1)}, minmax(320px, 1fr)); overflow-x: auto; padding-bottom: 8px; }
      .target-column { background: rgb(255 255 255 / 72%); border: 1px solid rgb(0 0 0 / 10%); border-radius: 10px; display: grid; gap: 12px; min-width: 320px; padding: 12px; }
      .target-title { font-size: 13px; font-weight: 800; margin: 0; text-transform: uppercase; }
      .widget-card { border: 1px solid rgb(0 0 0 / 10%); border-radius: 9px; display: grid; gap: 8px; overflow: hidden; }
      .widget-label { align-items: baseline; background: rgb(250 250 250 / 92%); border-bottom: 1px solid rgb(0 0 0 / 8%); display: flex; justify-content: space-between; padding: 8px 10px; }
      .widget-name { font-weight: 700; }
      .widget-id { color: #71717a; font: 12px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; }
      iframe { background: transparent; border: 0; height: 360px; width: 100%; }
      .empty { border: 1px dashed rgb(0 0 0 / 18%); border-radius: 9px; color: #71717a; padding: 18px; }
      .theme-section[data-theme="light"] { background: #f4f4f5; color: #18181b; }
      .theme-section[data-theme="dark"] { background: #111113; color: #f4f4f5; }
      .theme-section[data-theme="dark"] .theme-title { color: #d4d4d8; }
      .theme-section[data-theme="dark"] .target-column,
      .theme-section[data-theme="dark"] .widget-card { background: rgb(24 24 27 / 72%); border-color: rgb(255 255 255 / 12%); }
      .theme-section[data-theme="dark"] .widget-label { background: rgb(39 39 42 / 72%); border-bottom-color: rgb(255 255 255 / 10%); }
      .theme-section[data-theme="dark"] .widget-id,
      .theme-section[data-theme="dark"] .empty { color: #a1a1aa; }
    </style>
  </head>
  <body>
    <header>
      <h1>Sidecar preview</h1>
      <span class="summary">${toolCount} widget${toolCount === 1 ? "" : "s"} across ${builds.length} target${builds.length === 1 ? "" : "s"}</span>
    </header>
    ${sections}
  </body>
</html>`;
}

/** Renders one light/dark catalog section. */
function renderProjectPreviewTheme(
  builds: readonly ProjectPreviewBuild[],
  theme: ComponentPreviewTheme,
): string {
  const columns = builds.map((build) => renderProjectPreviewTarget(build, theme)).join("");
  return `<section class="theme-section" data-theme="${theme}">
    <h2 class="theme-title">${escapeHtml(theme)}</h2>
    <div class="target-grid">${columns}</div>
  </section>`;
}

/** Renders one target column in the project preview catalog. */
function renderProjectPreviewTarget(build: ProjectPreviewBuild, theme: ComponentPreviewTheme): string {
  const widgets = build.manifest.tools
    .filter((tool) => tool.widget?.outputFile)
    .map((tool) => renderProjectPreviewWidget(build.target, tool, theme))
    .join("");
  return `<section class="target-column">
    <h3 class="target-title">${escapeHtml(previewTargetLabel(build.target))}</h3>
    ${widgets || `<div class="empty">No widgets found for ${escapeHtml(build.target)}.</div>`}
  </section>`;
}

/** Renders one widget iframe in the project preview catalog. */
function renderProjectPreviewWidget(
  target: SidecarTarget,
  tool: SidecarToolManifestEntry,
  theme: ComponentPreviewTheme,
): string {
  const src = `/widget?target=${encodeURIComponent(target)}&tool=${encodeURIComponent(tool.id)}&theme=${theme}`;
  return `<article class="widget-card">
    <div class="widget-label">
      <span class="widget-name">${escapeHtml(tool.name)}</span>
      <span class="widget-id">${escapeHtml(tool.id)}</span>
    </div>
    <iframe title="${escapeHtml(`${tool.name} ${target} ${theme}`)}" src="${escapeHtml(src)}"></iframe>
  </article>`;
}

/** Injects deterministic host context and tool result data into a compiled widget document. */
export function injectProjectPreviewBridge(
  html: string,
  tool: SidecarToolManifestEntry,
  target: SidecarTarget,
  theme: ComponentPreviewTheme,
): string {
  const host = previewHostName(target);
  const preview = {
    hostContext: {
      name: host,
      theme,
      source: "mcp-apps",
      raw: {
        theme,
        userAgent: `Sidecar Preview ${previewTargetLabel(target)}`,
        displayMode: "inline",
        availableDisplayModes: ["inline", "fullscreen", "pip"],
      },
    },
    hostCapabilities: {
      openLinks: {},
      serverTools: {},
      serverResources: {},
      logging: {},
      message: { text: {}, structuredContent: {} },
      updateModelContext: { structuredContent: {} },
    },
    toolInput: {
      arguments: previewToolArguments(tool),
    },
    toolResult: previewToolResult(tool),
  };
  const script = `<script>window.__sidecarPreview=${escapeScriptJson(preview)};</script>`;
  return html
    .replace("<html lang=\"en\"", `<html lang="en" data-sidecar-host="${host}" data-sidecar-theme="${theme}" data-theme="${theme}"`)
    .replace("</head>", `${script}\n  </head>`);
}

/** Creates a stable sample MCP tool result for visual widget previews. */
function previewToolResult(tool: SidecarToolManifestEntry): Record<string, unknown> {
  const content = [
    `# ${tool.name}`,
    "",
    tool.description,
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Tool | ${escapeMarkdownTableCell(tool.id)} |`,
    "| Preview | Ready |",
  ].join("\n");
  const structuredContent = {
    tool: tool.id,
    ok: true,
    text: content,
    preview: {
      kind: previewKind(tool),
      title: tool.name,
      summary: tool.description,
      content,
      items: [
        {
          title: `${tool.name} preview`,
          body: tool.description,
        },
        {
          title: "Table rendering",
          body: "Preview data includes a Markdown table.",
        },
      ],
    },
    upstream: {
      isError: false,
    },
  };

  return {
    structuredContent,
    content: [{ type: "text", text: tool.description }],
    _meta: {
      sidecarPreview: true,
      tool: tool.id,
    },
    isError: false,
  };
}

/** Creates sample tool input for widgets that inspect original arguments. */
function previewToolArguments(tool: SidecarToolManifestEntry): Record<string, unknown> {
  const properties = tool.descriptor.inputSchema?.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(properties).map(([key, schema]) => [key, previewValueForSchema(schema)]),
  );
}

/** Creates one sample value for a JSON Schema property. */
function previewValueForSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") {
    return "preview";
  }
  const record = schema as Record<string, unknown>;
  if (Array.isArray(record.enum) && record.enum.length) {
    return record.enum[0];
  }
  switch (record.type) {
    case "number":
    case "integer":
      return 1;
    case "boolean":
      return true;
    case "array":
      return [];
    case "object":
      return {};
    default:
      return "preview";
  }
}

/** Chooses a preview kind that matches common Sidecar example widget shapes. */
function previewKind(tool: SidecarToolManifestEntry): string {
  const id = tool.id.toLowerCase();
  if (id.includes("search") || id.includes("query")) {
    return "search";
  }
  if (id.includes("create") || id.includes("update") || id.includes("move") || id.includes("duplicate")) {
    return "write";
  }
  if (id.includes("fetch") || id.includes("read") || id.includes("get")) {
    return "read";
  }
  return "metadata";
}

/** Maps build targets to runtime host names supported by Sidecar widgets. */
function previewHostName(target: SidecarTarget): "chatgpt" | "claude" | "generic" {
  if (target === "chatgpt") {
    return "chatgpt";
  }
  if (target === "claude") {
    return "claude";
  }
  return "generic";
}

/** Returns a human-readable preview label for one target column. */
function previewTargetLabel(target: SidecarTarget): string {
  switch (target) {
    case "chatgpt":
      return "ChatGPT";
    case "claude":
      return "Claude";
    default:
      return "MCP";
  }
}

/** Escapes JSON so it can be safely embedded in an inline script. */
function escapeScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** Escapes Markdown table separators in sample data. */
function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\|/g, "\\|");
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

/** Parses the build targets selected for the project preview command. */
export function readPreviewTargets(argv: string[]): SidecarTarget[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--target") {
      continue;
    }
    const value = argv[index + 1];
    if (value) {
      values.push(...value.split(",").map((entry) => entry.trim()).filter(Boolean));
    }
  }

  if (!values.length) {
    return ["mcp", "chatgpt", "claude"];
  }

  const targets = values.map((target) => {
    if (target === "mcp" || target === "chatgpt" || target === "claude") {
      return target;
    }
    throw new Error(`Unsupported Sidecar target "${target}". Expected mcp, chatgpt, or claude.`);
  });
  return Array.from(new Set(targets));
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

/** Loads `remote.ts` at runtime for code-mode dev servers when configured. */
async function loadRuntimeRemote(rootDir: string): Promise<RemoteExecutionDefinition | undefined> {
  const remotePath = path.join(rootDir, "remote.ts");
  if (!existsSync(remotePath)) {
    return undefined;
  }

  const parentURL = pathToFileURL(path.join(rootDir, "sidecar.config.ts")).href;
  const tsconfigPath = path.join(rootDir, "tsconfig.json");
  const tsconfig = existsSync(tsconfigPath) ? tsconfigPath : false;
  const module = (await tsImport(pathToFileURL(remotePath).href, {
    parentURL,
    tsconfig
  })) as { default?: unknown };

  const defaultExport = unwrapRuntimeDefault(module.default);
  if (!isSidecarRemote(defaultExport)) {
    throw new Error("remote.ts must default-export remote({ execute }) from sidecar-ai/remote.");
  }

  return defaultExport;
}

/** Returns true when config requires a project-owned remote executor. */
function manifestCodeModeNeedsRemote(config: SidecarConfig | undefined): boolean {
  if (!config?.codeMode || !config.remoteExecution) {
    return false;
  }
  if (config.codeMode === true) {
    return true;
  }
  return !config.codeMode.unsafe;
}

/** Starts the compiled MCP server used by `sidecar dev`. */
async function startBuiltMcpServer(options: {
  rootDir: string;
  outDir: string;
  port: number;
  mcpUrl: string;
}): Promise<ChildProcess> {
  const rootDir = path.resolve(options.rootDir);
  const entrypoint = path.join(rootDir, options.outDir, SERVER_ENTRYPOINT);
  const child = spawn(execPath, [entrypoint], {
    cwd: rootDir,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(options.port),
      SIDECAR_HOST: "127.0.0.1",
      SIDECAR_MCP_URL: options.mcpUrl,
      SIDECAR_PORT: String(options.port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output: string[] = [];
  child.stdout?.on("data", (chunk) => output.push(String(chunk)));
  child.stderr?.on("data", (chunk) => output.push(String(chunk)));
  try {
    await waitForBuiltMcpServer(child, options.port, output);
  } catch (error) {
    await stopBuiltMcpServer(child);
    throw error;
  }
  return child;
}

/** Stops the compiled MCP server used by `sidecar dev`. */
async function stopBuiltMcpServer(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

/** Waits until the compiled MCP server is accepting local HTTP requests. */
async function waitForBuiltMcpServer(
  child: ChildProcess,
  port: number,
  output: string[],
): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Sidecar dev MCP process exited before startup.\n${output.join("").trim()}`);
    }
    try {
      await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "GET",
        headers: { accept: "application/json, text/event-stream" },
      });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Timed out waiting for Sidecar dev MCP server on 127.0.0.1:${port}.\n${output.join("").trim()}`);
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
  if (manifest.codeMode?.widget?.outputFile) {
    const text = await readFile(path.join(rootDir, outDir, manifest.codeMode.widget.outputFile), "utf8");
    resources.push({
      uri: manifest.codeMode.widget.resourceUri,
      name: "Execute Code",
      description: manifest.codeMode.widget.options?.description,
      mimeType: MCP_APP_RESOURCE_MIME_TYPE,
      text,
      _meta: manifest.codeMode.widget.resourceMeta,
    });
  }

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
    Object.keys(value).every((key) => key === "default" || key === "__esModule")
  ) {
    return unwrapRuntimeDefault((value as { default: unknown }).default);
  }
  return value;
}

/** Starts an HTTP server on an ephemeral local port. */
function listenOnAnyPort(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      reject(error);
    };
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      const address = server.address() as AddressInfo | null;
      if (!address) {
        reject(new Error("Preview server did not expose a bound address."));
        return;
      }
      resolve(address.port);
    });
  });
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
