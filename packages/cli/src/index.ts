#!/usr/bin/env node
/**
 * Sidecar command-line interface.
 *
 * The CLI currently provides the vertical slice needed for local development:
 * static inspection, build output generation, and a dev MCP server.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cwd, exit, stdin, stdout } from "node:process";
import { tsImport } from "tsx/esm/api";
import { isSidecarAuth, type SidecarAuth } from "@sidecar/auth";
import {
  analyzeProjectTools,
  buildProject,
  collectProjectDiagnostics,
  formatDiagnostic,
  type SidecarDiagnostic,
  type SidecarManifest,
} from "@sidecar/compiler";
import { isSidecarTool } from "@sidecar/core";
import { createSidecarHttpServer, type LoadedResource, type LoadedTool } from "@sidecar/server";
import { startTunnel, type TunnelProvider, type TunnelSession } from "./tunnel.js";

type Command = "build" | "check" | "dev" | "inspect" | "preview" | "help";

/** Dispatches the requested CLI command. */
async function main(argv: string[]): Promise<void> {
  const command = (argv[2] ?? "help") as Command;
  const rootDir = readOption(argv, "--cwd") ?? cwd();

  switch (command) {
    case "build": {
      const outDir = readOption(argv, "--out") ?? "out/mcp";
      const plugins = argv.includes("--plugins");
      const strict = argv.includes("--strict");
      const manifest = await buildProject({ rootDir, outDir, plugins, strict });
      printDiagnostics(manifest.diagnostics ?? []);
      if (strict && manifest.diagnostics?.length) {
        exit(1);
      }
      console.log(`Built ${manifest.tools.length} tool${manifest.tools.length === 1 ? "" : "s"} to ${outDir}.`);
      if (plugins) {
        console.log("Built codex-plugin and claude-plugin packages.");
      }
      return;
    }

    case "check": {
      const tools = await analyzeProjectTools(rootDir);
      const diagnostics = await collectProjectDiagnostics(rootDir, tools);
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
      const tunnelProvider = readTunnelProvider(argv);
      const outDir = ".sidecar/dev/mcp";
      const manifest = await buildProject({ rootDir, outDir });
      printDiagnostics(manifest.diagnostics ?? []);
      const tools = await loadRuntimeTools(rootDir, manifest);
      let tunnel: TunnelSession | undefined;
      if (tunnelProvider) {
        tunnel = await startTunnel({ provider: tunnelProvider, port, path: "/mcp" });
        process.env.SIDECAR_MCP_URL = tunnel.mcpUrl;
      }

      const loadedAuth = await loadRuntimeAuth(rootDir);
      const auth = loadedAuth && tunnel ? loadedAuth.withResource(tunnel.mcpUrl) : loadedAuth;
      const resources = await loadResources(rootDir, outDir, manifest);
      const server = createSidecarHttpServer({
        name: "sidecar-dev",
        version: "0.0.0-dev",
        path: "/mcp",
        auth,
        tools,
        resources
      });

      server.listen(port, () => {
        console.log(`MCP running on Streamable HTTP at http://127.0.0.1:${port}/mcp`);
        console.log(`Loaded ${tools.length} tool${tools.length === 1 ? "" : "s"} and ${resources.length} resource${resources.length === 1 ? "" : "s"}.`);
        if (tunnel) {
          console.log(`HTTPS tunnel (${tunnel.provider}) ready: ${tunnel.mcpUrl}`);
          console.log("Use this HTTPS MCP URL in ChatGPT, Claude, or a desktop plugin install.");
        }
      });

      const shutdown = () => {
        tunnel?.close();
        server.close(() => exit(0));
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
      return;
    }

    case "inspect": {
      const tools = await analyzeProjectTools(rootDir);
      if (!tools.length) {
        console.log("No Sidecar tools found.");
        return;
      }

      for (const tool of tools) {
        console.log(`${tool.id} — ${tool.name}`);
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
        approve: !argv.includes("--no-approve"),
      });
      return;
    }

    case "help":
    default:
      console.log(`Sidecar

Usage:
  sidecar build [--cwd <dir>] [--out <dir>] [--plugins] [--strict]
  sidecar check [--cwd <dir>] [--strict]
  sidecar dev [--cwd <dir>] [--port <port>] [--tunnel [cloudflared|wrangler]]
  sidecar inspect [--cwd <dir>]
  sidecar preview components [--cwd <dir>] [--host chatgpt|claude|generic] [--compare native,openai] [--port <port>] [--no-approve]
`);
  }
}

/** Options for the component parity preview command. */
type ComponentPreviewOptions = {
  rootDir: string;
  host: string;
  port: number;
  compare: string;
  approve: boolean;
};

/** Starts a component matrix preview and optionally records human approval. */
async function previewComponents(options: ComponentPreviewOptions): Promise<void> {
  const cliDir = path.dirname(fileURLToPath(import.meta.url));
  const css = await readFile(path.join(cliDir, "../../native/src/styles.css"), "utf8")
    .catch(() => readFile(path.join(process.cwd(), "packages/native/src/styles.css"), "utf8"))
    .catch(() => "");
  const html = renderComponentPreviewHtml(options.host, options.compare, css);
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
      components: ["Button", "TextField", "Checkbox", "Badge", "Surface", "Skeleton"],
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
function renderComponentPreviewHtml(host: string, compare: string, css: string): string {
  const columns = compare.split(",").map((entry) => entry.trim()).filter(Boolean);
  const theme = "light";
  const cells = columns
    .map((column) => renderPreviewColumn(column, host))
    .join("");

  return `<!doctype html>
<html lang="en" data-sidecar-host="${escapeHtml(host)}" data-sidecar-theme="${theme}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sidecar component preview</title>
    <style>
      ${css}
      body { padding: 24px; }
      .preview-grid { display: grid; gap: 20px; grid-template-columns: repeat(${Math.max(columns.length, 1)}, minmax(240px, 1fr)); }
      .preview-column { display: flex; flex-direction: column; gap: 14px; }
      .preview-label { color: var(--sc-muted); font: 600 12px/1.2 var(--sc-font-sans); text-transform: uppercase; }
    </style>
  </head>
  <body>
    <main class="preview-grid">${cells}</main>
  </body>
</html>`;
}

/** Renders one package/recipe column in the preview matrix. */
function renderPreviewColumn(column: string, host: string): string {
  const recipe = column === "native" ? "auto" : column === "openai" ? "chatgpt" : column === "anthropic" ? "claude" : host;
  return `<section class="preview-column">
    <div class="preview-label">${escapeHtml(column)}</div>
    <button data-sc-component="button" data-sc-intent="primary" data-sc-recipe="${recipe}" type="button"><span data-sc-component="button-label">Primary</span></button>
    <button data-sc-component="button" data-sc-intent="secondary" data-sc-recipe="${recipe}" type="button"><span data-sc-component="button-label">Secondary</span></button>
    <button data-sc-component="button" data-sc-intent="ghost" data-sc-recipe="${recipe}" type="button"><span data-sc-component="button-label">Ghost</span></button>
    <input data-sc-component="textfield" data-sc-recipe="${recipe}" value="Text field" />
    <label data-sc-component="checkbox-label" data-sc-recipe="${recipe}"><input data-sc-component="checkbox" data-sc-recipe="${recipe}" type="checkbox" checked /> <span>Checkbox</span></label>
    <span data-sc-component="badge" data-sc-tone="success" data-sc-recipe="${recipe}">Badge</span>
    <div data-sc-component="surface" data-sc-variant="card" data-sc-recipe="${recipe}"><p data-sc-component="text" data-sc-recipe="${recipe}">Surface text</p></div>
    <div data-sc-component="skeleton" data-sc-recipe="${recipe}" style="width: 100%; height: 24px;"></div>
  </section>`;
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

  if (!isSidecarAuth(module.default)) {
    throw new Error("auth.ts must default-export auth({ ... }) from @sidecar/auth.");
  }

  return module.default;
}

/** Imports built-time discovered tools for the dev server. */
async function loadRuntimeTools(rootDir: string, manifest: SidecarManifest): Promise<LoadedTool[]> {
  const parentURL = pathToFileURL(path.join(rootDir, "sidecar.config.ts")).href;
  const tsconfigPath = path.join(rootDir, "tsconfig.json");
  const tsconfig = existsSync(tsconfigPath) ? tsconfigPath : false;
  const loaded: LoadedTool[] = [];

  for (const entry of manifest.tools) {
    const sourcePath = path.join(rootDir, entry.sourceFile);
    const module = (await tsImport(pathToFileURL(sourcePath).href, {
      parentURL,
      tsconfig
    })) as { default?: unknown };

    if (!isSidecarTool(module.default)) {
      throw new Error(`${entry.sourceFile} did not default-export a Sidecar tool.`);
    }

    loaded.push({
      tool: module.default,
      descriptor: entry.descriptor
    });
  }

  return loaded;
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
      mimeType: "text/html",
      text
    });
  }

  return resources;
}

/** Reads a simple `--name value` option from argv. */
function readOption(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return argv[index + 1];
}

main(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  exit(1);
});
