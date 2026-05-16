#!/usr/bin/env node
/**
 * Sidecar command-line interface.
 *
 * The CLI currently provides the vertical slice needed for local development:
 * static inspection, build output generation, and a dev MCP server.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { cwd, exit } from "node:process";
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

type Command = "build" | "check" | "dev" | "inspect" | "help";

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
        console.log(`Sidecar dev server listening at http://127.0.0.1:${port}/mcp`);
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

    case "help":
    default:
      console.log(`Sidecar

Usage:
  sidecar build [--cwd <dir>] [--out <dir>] [--plugins] [--strict]
  sidecar check [--cwd <dir>] [--strict]
  sidecar dev [--cwd <dir>] [--port <port>] [--tunnel [cloudflared|ngrok]]
  sidecar inspect [--cwd <dir>]
`);
  }
}

/** Reads `--tunnel`, supporting either a bare flag or an explicit provider. */
function readTunnelProvider(argv: string[]): TunnelProvider | undefined {
  const index = argv.indexOf("--tunnel");
  if (index === -1) {
    return undefined;
  }

  const value = argv[index + 1];
  if (value === "cloudflared" || value === "ngrok") {
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
