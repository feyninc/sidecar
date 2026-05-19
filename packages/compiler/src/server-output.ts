/** Hostable Node server artifact generation for Sidecar builds. */
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { build as esbuild } from "esbuild";
import type { ProjectIdentity, SidecarHost, SidecarManifest } from "./types.js";
import { toImportSpecifier } from "./utils.js";

/** Relative location of the generated server entrypoint inside a build output. */
export const SERVER_ENTRYPOINT = "server/index.js";

/** Relative location of the Vercel Build Output API function directory. */
export const VERCEL_FUNCTION_DIR = "functions/api/sidecar.func";

/** Relative location of the Vercel Build Output API function entrypoint. */
export const VERCEL_ENTRYPOINT = `${VERCEL_FUNCTION_DIR}/index.js`;

/** File name Vercel invokes inside the Build Output API function directory. */
const VERCEL_HANDLER_FILE = "index.js";

/** Emits a bundled Node MCP server that can be started with `node server/index.js`. */
export async function buildServerOutput(
  rootDir: string,
  outDir: string,
  manifest: SidecarManifest,
  identity: ProjectIdentity,
  host: SidecarHost = "node",
  options: { vercelOutputDir?: string } = {},
): Promise<void> {
  const cacheDir = path.join(rootDir, ".sidecar", "cache", "server");
  await mkdir(cacheDir, { recursive: true });

  const entryFile = path.join(cacheDir, "index.ts");
  await writeFile(entryFile, renderServerEntry(rootDir, entryFile, manifest, identity));

  const serverFile = path.join(outDir, SERVER_ENTRYPOINT);
  await mkdir(path.dirname(serverFile), { recursive: true });
  await esbuild({
    absWorkingDir: rootDir,
    alias: sidecarBundleAliases(rootDir),
    banner: {
      js: `import { createRequire as __sidecarCreateRequire } from "node:module";\nconst require = __sidecarCreateRequire(import.meta.url);`,
    },
    bundle: true,
    entryPoints: [entryFile],
    format: "esm",
    legalComments: "none",
    minify: false,
    nodePaths: [
      path.join(rootDir, "node_modules"),
      path.join(process.cwd(), "node_modules"),
    ],
    outfile: serverFile,
    platform: "node",
    sourcemap: false,
    target: "node20",
  });

  await writeFile(path.join(outDir, "package.json"), renderServerPackage(identity));
  if (host === "vercel") {
    const vercelOutputDir = options.vercelOutputDir ?? outDir;
    await rm(path.join(vercelOutputDir, "api"), { recursive: true, force: true });
    await rm(path.join(vercelOutputDir, "vercel.json"), { force: true });
    await writeFile(path.join(outDir, VERCEL_HANDLER_FILE), renderVercelEntrypoint());
    await writeFile(path.join(outDir, ".vc-config.json"), renderVercelFunctionConfig());
    await mkdir(vercelOutputDir, { recursive: true });
    await writeFile(path.join(vercelOutputDir, "config.json"), renderVercelOutputConfig());
  } else {
    await rm(path.join(outDir, "api"), { recursive: true, force: true });
    await rm(path.join(outDir, "vercel.json"), { force: true });
  }
}

/** Renders the temporary TypeScript entrypoint that esbuild bundles. */
function renderServerEntry(
  rootDir: string,
  entryFile: string,
  manifest: SidecarManifest,
  identity: ProjectIdentity,
): string {
  const entryDir = path.dirname(entryFile);
  const tools = manifest.tools;
  const resources = manifest.resources;
  const prompts = manifest.prompts;

  const imports = [
    `import { readFileSync, realpathSync } from "node:fs";`,
    `import { createServer } from "node:http";`,
    `import { pathToFileURL } from "node:url";`,
    `import { createSidecarHttpHandler } from "@sidecar-ai/server";`,
    `import { isSidecarAuth } from "@sidecar-ai/auth";`,
    `import { isSidecarPrompt, isSidecarResource, isSidecarTool } from "@sidecar-ai/core";`,
    `import { isSidecarProxy } from "@sidecar-ai/server/proxy";`,
    ...tools.map((entry, index) =>
      `import tool${index} from ${JSON.stringify(toImportSpecifier(entryDir, path.join(rootDir, entry.sourceFile)))};`,
    ),
    ...resources.map((entry, index) =>
      `import resource${index} from ${JSON.stringify(toImportSpecifier(entryDir, path.join(rootDir, entry.sourceFile)))};`,
    ),
    ...prompts.map((entry, index) =>
      `import prompt${index} from ${JSON.stringify(toImportSpecifier(entryDir, path.join(rootDir, entry.sourceFile)))};`,
    ),
    existsSync(path.join(rootDir, "auth.ts"))
      ? `import authExport from ${JSON.stringify(toImportSpecifier(entryDir, path.join(rootDir, "auth.ts")))};`
      : `const authExport = undefined;`,
    existsSync(path.join(rootDir, "proxy.ts"))
      ? `import proxyExport from ${JSON.stringify(toImportSpecifier(entryDir, path.join(rootDir, "proxy.ts")))};`
      : `const proxyExport = undefined;`,
    existsSync(path.join(rootDir, "sidecar.config.ts"))
      ? `import configExport from ${JSON.stringify(toImportSpecifier(entryDir, path.join(rootDir, "sidecar.config.ts")))};`
      : `const configExport = undefined;`,
  ].join("\n");

  return `${imports}

const manifest = ${JSON.stringify(manifest, null, 2)};
const identity = ${JSON.stringify(identity, null, 2)};

const loadedAuth = authExport === undefined ? undefined : assertAuth(authExport);
const auth = loadedAuth && process.env.SIDECAR_MCP_URL
  ? loadedAuth.withResource(process.env.SIDECAR_MCP_URL)
  : loadedAuth;
const proxy = proxyExport === undefined ? undefined : assertProxy(proxyExport);
const runtimeConfig = configExport && typeof configExport === "object" ? configExport : undefined;

if (auth && !process.env.SIDECAR_MCP_URL) {
  console.warn("Sidecar auth is enabled. Set SIDECAR_MCP_URL to the public https://.../mcp URL before hosting.");
}

export const handler = createSidecarHttpHandler({
  name: identity.name,
  version: identity.version,
  path: process.env.SIDECAR_MCP_PATH ?? "/mcp",
  publicUrl: process.env.SIDECAR_PUBLIC_URL ?? process.env.SIDECAR_MCP_URL,
  auth,
  proxy,
  tools: [
${tools.map((entry, index) => `    loadTool(${JSON.stringify(entry.sourceFile)}, tool${index}, manifest.tools[${index}].descriptor),`).join("\n")}
  ],
  resources: [
${renderWidgetResources(manifest)}
${resources.map((entry, index) => `    loadResource(${JSON.stringify(entry.sourceFile)}, resource${index}, manifest.resources[${index}]),`).join("\n")}
  ],
  resourceTemplates: manifest.resourceTemplates.map((entry) => ({ descriptor: entry.descriptor })),
  prompts: [
${prompts.map((entry, index) => `    loadPrompt(${JSON.stringify(entry.sourceFile)}, prompt${index}, manifest.prompts[${index}].descriptor),`).join("\n")}
  ],
  capabilities: {
    tools: runtimeConfig?.tools ?? manifest.config.tools,
    resources: runtimeConfig?.resources ?? manifest.config.resources,
    prompts: runtimeConfig?.prompts ?? manifest.config.prompts,
  },
  pagination: runtimeConfig?.pagination ?? {
    pageSize: manifest.config.pagination.pageSize,
  },
});

export default handler;

export const server = createServer(handler);

if (isDirectRun()) {
  const port = readPort();
  const host = process.env.SIDECAR_HOST ?? process.env.HOST ?? "0.0.0.0";
  server.listen(port, host, () => {
    const localHost = host === "0.0.0.0" ? "127.0.0.1" : host;
    console.log(\`MCP running on Streamable HTTP at http://\${localHost}:\${port}\${process.env.SIDECAR_MCP_PATH ?? "/mcp"}\`);
  });

  process.on("SIGTERM", () => shutdown());
  process.on("SIGINT", () => shutdown());
}

function loadTool(sourceFile, value, descriptor) {
  const tool = unwrapRuntimeDefault(value);
  if (!isSidecarTool(tool)) {
    throw new Error(\`\${sourceFile} did not default-export a Sidecar tool.\`);
  }
  return { tool, descriptor };
}

function loadResource(sourceFile, value, entry) {
  const resource = unwrapRuntimeDefault(value);
  if (!isSidecarResource(resource)) {
    throw new Error(\`\${sourceFile} did not default-export a Sidecar resource.\`);
  }
  return {
    uri: entry.uri,
    descriptor: entry.descriptor,
    resource,
  };
}

function loadPrompt(sourceFile, value, descriptor) {
  const prompt = unwrapRuntimeDefault(value);
  if (!isSidecarPrompt(prompt)) {
    throw new Error(\`\${sourceFile} did not default-export a Sidecar prompt.\`);
  }
  return { prompt, descriptor };
}

function assertAuth(value) {
  const authValue = unwrapRuntimeDefault(value);
  if (!isSidecarAuth(authValue)) {
    throw new Error("auth.ts must default-export auth({ ... }) from sidecar-ai.");
  }
  return authValue;
}

function assertProxy(value) {
  const proxyValue = unwrapRuntimeDefault(value);
  if (!isSidecarProxy(proxyValue)) {
    throw new Error("proxy.ts must default-export proxy({ ... }) from @sidecar-ai/server/proxy.");
  }
  return proxyValue;
}

function unwrapRuntimeDefault(value) {
  if (
    value &&
    typeof value === "object" &&
    "default" in value &&
    Object.keys(value).length === 1
  ) {
    return unwrapRuntimeDefault(value.default);
  }
  return value;
}

function readWidget(outputFile) {
  return readFileSync(new URL(\`../\${outputFile}\`, import.meta.url), "utf8");
}

function readPort() {
  const raw = process.env.PORT ?? process.env.SIDECAR_PORT ?? "3001";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(\`Invalid PORT/SIDECAR_PORT value: \${raw}\`);
  }
  return port;
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }

  return import.meta.url === pathToFileURL(realpathSync(entry)).href;
}

function shutdown() {
  server.close(() => process.exit(0));
}
`;
}

/** Renders generated widget resources as static MCP resource entries. */
function renderWidgetResources(manifest: SidecarManifest): string {
  return manifest.tools
    .filter((entry) => entry.widget?.outputFile)
    .map((entry) => `    {
      uri: ${JSON.stringify(entry.widget?.resourceUri)},
      name: ${JSON.stringify(entry.name)},
      description: ${JSON.stringify(entry.widget?.options?.description)},
      mimeType: "text/html;profile=mcp-app",
      text: readWidget(${JSON.stringify(entry.widget?.outputFile)}),
      _meta: ${JSON.stringify(entry.widget?.resourceMeta ?? undefined)},
    },`)
    .join("\n");
}

/** Writes a minimal package manifest for hosts that run the build output directly. */
function renderServerPackage(identity: ProjectIdentity): string {
  return `${JSON.stringify({
    name: `${identity.slug}-sidecar-server`,
    version: identity.version,
    private: true,
    type: "module",
    scripts: {
      start: "node server/index.js",
    },
    engines: {
      node: ">=20",
    },
  }, null, 2)}\n`;
}

/** Emits a Vercel function shim that reuses the generated Node request handler. */
function renderVercelEntrypoint(): string {
  return `export { default } from "./server/index.js";
`;
}

/** Emits Build Output API metadata for the Vercel Node.js function. */
function renderVercelFunctionConfig(): string {
  return `${JSON.stringify({
    runtime: "nodejs22.x",
    handler: VERCEL_HANDLER_FILE,
    launcherType: "Nodejs",
    shouldAddHelpers: true,
    supportsResponseStreaming: true,
    maxDuration: 300,
  }, null, 2)}\n`;
}

/** Emits Vercel Build Output API routing to the generated MCP function. */
function renderVercelOutputConfig(): string {
  return `${JSON.stringify({
    version: 3,
    routes: [
      {
        src: "/(.*)",
        dest: "/api/sidecar",
      },
    ],
  }, null, 2)}\n`;
}

/** Resolves workspace package imports to source when building this monorepo's examples. */
function sidecarBundleAliases(rootDir: string): Record<string, string> | undefined {
  const repoRoot = findSidecarRepoRoot(rootDir) ?? findSidecarRepoRoot(process.cwd());
  if (!repoRoot) {
    return undefined;
  }

  return {
    "sidecar-ai": path.join(repoRoot, "packages", "sidecar-ai", "src", "index.ts"),
    "@sidecar-ai/auth": path.join(repoRoot, "packages", "auth", "src", "index.ts"),
    "@sidecar-ai/core": path.join(repoRoot, "packages", "core", "src", "index.ts"),
    "@sidecar-ai/server": path.join(repoRoot, "packages", "server", "src", "index.ts"),
    "@sidecar-ai/server/proxy": path.join(repoRoot, "packages", "server", "src", "proxy.ts"),
    "@sidecar-ai/client": path.join(repoRoot, "packages", "client", "src", "index.ts"),
    "@sidecar-ai/react": path.join(repoRoot, "packages", "react", "src", "index.ts"),
    "@sidecar-ai/native": path.join(repoRoot, "packages", "native", "src", "index.ts"),
    "@sidecar-ai/native/components": path.join(repoRoot, "packages", "native", "src", "components", "index.tsx"),
    "@sidecar-ai/openai": path.join(repoRoot, "packages", "openai", "src", "index.ts"),
    "@sidecar-ai/openai/components": path.join(repoRoot, "packages", "openai", "src", "components.tsx"),
    "@sidecar-ai/openai/official": path.join(repoRoot, "packages", "openai", "src", "official.ts"),
    "@sidecar-ai/anthropic": path.join(repoRoot, "packages", "anthropic", "src", "index.ts"),
    "@sidecar-ai/anthropic/agent": path.join(repoRoot, "packages", "anthropic", "src", "agent.ts"),
    "@sidecar-ai/anthropic/command": path.join(repoRoot, "packages", "anthropic", "src", "command.ts"),
    "@sidecar-ai/anthropic/components": path.join(repoRoot, "packages", "anthropic", "src", "components.tsx"),
    "@sidecar-ai/anthropic/hooks": path.join(repoRoot, "packages", "anthropic", "src", "hooks.ts"),
    "@sidecar-ai/anthropic/mcp": path.join(repoRoot, "packages", "anthropic", "src", "mcp.ts"),
    "@sidecar-ai/anthropic/plugin": path.join(repoRoot, "packages", "anthropic", "src", "plugin.ts"),
    "@sidecar-ai/anthropic/skill": path.join(repoRoot, "packages", "anthropic", "src", "skill.ts"),
  };
}

/** Finds the Sidecar repository root for source aliases used by workspace tests. */
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
