/** Build orchestration for Sidecar projects. */
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { analyzeProjectTools } from "./analyze.js";
import { analyzeProjectConfig } from "./config.js";
import { collectProjectDiagnostics, formatDiagnostic } from "./diagnostics.js";
import { writeGeneratedTypes } from "./generated.js";
import { loadProjectIdentity } from "./identity.js";
import { buildPluginPackages } from "./plugins.js";
import { analyzeProjectPrompts } from "./prompts.js";
import { analyzeProjectResources } from "./resources.js";
import { VERCEL_FUNCTION_DIR, buildServerOutput } from "./server-output.js";
import type { BuildProjectOptions, SidecarManifest, SidecarResourceTemplateManifestEntry } from "./types.js";
import { buildCodeModeWidget, buildWidgets } from "./widgets.js";

/** Builds the MCP output, generated types, and optional plugin packages. */
export async function buildProject(
  options: BuildProjectOptions,
): Promise<SidecarManifest> {
  const rootDir = path.resolve(options.rootDir);
  const config = analyzeProjectConfig(rootDir);
  const target = options.target ?? config.build.target ?? "mcp";
  const host = options.host ?? config.build.host ?? "node";
  const plugins = options.plugins ?? config.build.plugins ?? false;
  if (config.codeMode.enabled && !config.codeMode.unsafe && !config.remoteExecution.enabled) {
    throw new Error("Code mode requires remoteExecution: true, or codeMode: { unsafe: true } for trusted local use.");
  }
  if (config.codeMode.enabled && config.remoteExecution.enabled && !existsSync(path.join(rootDir, "remote.ts"))) {
    throw new Error("remoteExecution: true requires a reserved remote.ts file at the project root.");
  }
  const tools = await analyzeProjectTools(rootDir, { target });
  const resources = await analyzeProjectResources(rootDir);
  const resourceTemplates: SidecarResourceTemplateManifestEntry[] = [];
  const prompts = await analyzeProjectPrompts(rootDir);
  const identity = await loadProjectIdentity(rootDir);
  const diagnostics = await collectProjectDiagnostics(rootDir, {
    tools,
    resources,
    prompts,
    config,
  });
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length) {
    throw new Error(errors.map(formatDiagnostic).join("\n"));
  }

  const outDir = resolveInsideRoot(rootDir, options.outDir ?? config.build.outDir ?? defaultBuildOutDir(host, target));
  const runtimeOutDir = resolveRuntimeOutputDir(outDir, host);
  await buildWidgets(rootDir, runtimeOutDir, tools, config.build.widgets);
  const codeModeWidget = config.codeMode.enabled && config.codeMode.render.enabled
    ? await buildCodeModeWidget(rootDir, runtimeOutDir, tools, target, config.build.widgets)
    : undefined;

  const manifest: SidecarManifest = {
    version: 1,
    target,
    host,
    rootDir: ".",
    generatedAt: new Date().toISOString(),
    config,
    tools,
    codeMode: config.codeMode.enabled
      ? {
          enabled: true,
          unsafe: config.codeMode.unsafe,
          remoteExecution: config.remoteExecution.enabled,
          render: config.codeMode.render,
          widget: codeModeWidget,
        }
      : undefined,
    resources,
    resourceTemplates,
    prompts,
    diagnostics,
  };

  await mkdir(runtimeOutDir, { recursive: true });
  await writeFile(
    path.join(runtimeOutDir, "manifest.sidecar.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await writeFile(path.join(runtimeOutDir, "README.md"), renderMcpReadme(manifest));
  await writeGeneratedTypes(rootDir, tools);
  await buildServerOutput(rootDir, runtimeOutDir, manifest, identity, host, {
    vercelOutputDir: outDir,
  });
  if (plugins) {
    await buildPluginPackages(rootDir, resolvePluginOutputBase(rootDir, outDir, host), manifest);
  }

  return manifest;
}

/** Returns the conventional output directory for a host target. */
function defaultBuildOutDir(host: string, target: string): string {
  if (host === "vercel") {
    return ".vercel/output";
  }
  return `out/${target}`;
}

/** Chooses where runtime-private files live for the selected host. */
function resolveRuntimeOutputDir(outDir: string, host: string): string {
  if (host === "vercel") {
    return path.join(outDir, VERCEL_FUNCTION_DIR);
  }
  return outDir;
}

/** Chooses where installable plugin packages should be written. */
function resolvePluginOutputBase(rootDir: string, outDir: string, host: string): string {
  if (host === "vercel" && isVercelBuildOutputDir(outDir)) {
    return path.join(rootDir, "out");
  }
  return path.dirname(outDir);
}

/** Returns true for Vercel's required Build Output API directory. */
function isVercelBuildOutputDir(outDir: string): boolean {
  return path.basename(outDir) === "output" && path.basename(path.dirname(outDir)) === ".vercel";
}

/** Resolves build output paths while preventing writes outside the project. */
function resolveInsideRoot(rootDir: string, output: string): string {
  const resolved = path.resolve(rootDir, output);
  const relative = path.relative(rootDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Build output must stay inside the project root: ${output}`);
  }
  return resolved;
}

/** Renders a short build README with detected tools and install context. */
function renderMcpReadme(manifest: SidecarManifest): string {
  const tools = manifest.tools
    .map((toolEntry) => `- \`${toolEntry.id}\`: ${toolEntry.description}`)
    .join("\n");
  const resources = manifest.resources
    .map((resourceEntry) => `- \`${resourceEntry.uri}\`: ${resourceEntry.description ?? resourceEntry.name}`)
    .join("\n");
  const prompts = manifest.prompts
    .map((promptEntry) => `- \`${promptEntry.name}\`: ${promptEntry.description ?? promptEntry.title}`)
    .join("\n");

  return `# Sidecar MCP Build

Generated by Sidecar.

## Tools

${tools || "No tools detected."}

## Resources

${resources || "No resources detected."}

## Prompts

${prompts || "No prompts detected."}

${manifest.host === "vercel" ? renderVercelReadmeSection() : renderNodeReadmeSection()}

## Local HTTPS Testing

Run \`sidecar dev --tunnel\` from the project root to start the local MCP server on Streamable HTTP and print a validated HTTPS MCP URL that can be added to ChatGPT, Claude, or a Claude plugin install. Temporary quick tunnels are public and best-effort; use a configured tunnel/domain or deployed preview for repeatable testing.
`;
}

/** Renders generated README instructions for standalone Node output. */
function renderNodeReadmeSection(): string {
  return `## Run The Server

This output includes a standalone Node MCP server. Start it with:

\`\`\`sh
npm start
\`\`\`

or:

\`\`\`sh
node server/index.js
\`\`\`

Set \`PORT\` or \`SIDECAR_PORT\` to choose the listen port. Hosted/authenticated MCPs should set \`SIDECAR_MCP_URL\` to the public \`https://.../mcp\` URL before starting.
`;
}

/** Renders generated README instructions for Vercel output. */
function renderVercelReadmeSection(): string {
  return `## Deploy To Vercel

This output uses Vercel's Build Output API. The MCP function is emitted at \`${VERCEL_FUNCTION_DIR}\`, and \`config.json\` routes Streamable HTTP traffic to it. Set \`SIDECAR_MCP_URL\` to the public \`https://.../mcp\` URL in Vercel.
`;
}
