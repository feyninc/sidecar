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
import { buildProject, analyzeProjectTools, type SidecarManifest } from "@sidecar/compiler";
import { isSidecarTool } from "@sidecar/core";
import { createSidecarHttpServer, type LoadedResource, type LoadedTool } from "@sidecar/server";

type Command = "build" | "dev" | "inspect" | "help";

/** Dispatches the requested CLI command. */
async function main(argv: string[]): Promise<void> {
  const command = (argv[2] ?? "help") as Command;
  const rootDir = readOption(argv, "--cwd") ?? cwd();

  switch (command) {
    case "build": {
      const outDir = readOption(argv, "--out") ?? "out/mcp";
      const plugins = argv.includes("--plugins");
      const manifest = await buildProject({ rootDir, outDir, plugins });
      console.log(`Built ${manifest.tools.length} tool${manifest.tools.length === 1 ? "" : "s"} to ${outDir}.`);
      if (plugins) {
        console.log("Built codex-plugin and claude-plugin packages.");
      }
      return;
    }

    case "dev": {
      const port = Number(readOption(argv, "--port") ?? "3001");
      const outDir = ".sidecar/dev/mcp";
      const manifest = await buildProject({ rootDir, outDir });
      const tools = await loadRuntimeTools(rootDir, manifest);
      const auth = await loadRuntimeAuth(rootDir);
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
      });
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
  sidecar build [--cwd <dir>] [--out <dir>] [--plugins]
  sidecar dev [--cwd <dir>] [--port <port>]
  sidecar inspect [--cwd <dir>]
`);
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
