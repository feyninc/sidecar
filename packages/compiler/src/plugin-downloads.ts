/** Portable marketplace and ZIP generation for prepared Codex and Claude plugins. */
import { cp, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { writeZipArchive } from "./zip.js";

export type PluginMcpServer =
  | {
      type: "http";
      url: string;
      oauthResource?: string;
    }
  | {
      type: "stdio";
      command: string;
      args?: string[];
      cwd?: string;
      env?: Record<string, string>;
    };

export type PreparedPlugin = {
  /** Directory containing the complete platform plugin. */
  directory: string;
  /** MCP transport written into the copied plugin's `.mcp.json`. */
  mcpServer: PluginMcpServer;
};

export type CodexPluginPolicy = {
  installation: "AVAILABLE" | "REQUIRED";
  authentication: "ON_INSTALL" | "ON_USE";
};

export type BuildPluginDownloadsOptions = {
  outDir: string;
  codex: PreparedPlugin & {
    policy?: CodexPluginPolicy;
    category?: string;
  };
  claude: PreparedPlugin;
};

export type BuiltPluginDownloads = {
  slug: string;
  codexMarketplaceDir: string;
  claudeMarketplaceDir: string;
  codexZipPath: string;
  claudeZipPath: string;
};

type CodexPluginManifest = {
  name: string;
  version?: string;
  description?: string;
  author?: string | { name?: string };
  interface?: { displayName?: string; category?: string };
  mcpServers?: string;
  [key: string]: unknown;
};

type ClaudePluginManifest = {
  name: string;
  version?: string;
  description?: string;
  author?: string | { name?: string };
  [key: string]: unknown;
};

/** Builds native local marketplaces and downloadable ZIPs without mutating source plugins. */
export async function buildPluginDownloads(
  options: BuildPluginDownloadsOptions,
): Promise<BuiltPluginDownloads> {
  const outDir = path.resolve(options.outDir);
  const codexSource = path.resolve(options.codex.directory);
  const claudeSource = path.resolve(options.claude.directory);
  const codexManifest = await readJson<CodexPluginManifest>(
    path.join(codexSource, ".codex-plugin", "plugin.json"),
  );
  const claudeManifest = await readJson<ClaudePluginManifest>(
    path.join(claudeSource, ".claude-plugin", "plugin.json"),
  );
  const slug = validateIdentity(codexManifest, claudeManifest);

  validateMcpServer(options.codex.mcpServer, "codex");
  validateMcpServer(options.claude.mcpServer, "claude");

  const codexMarketplaceDir = path.join(outDir, "codex-marketplace");
  const claudeMarketplaceDir = path.join(outDir, "claude-marketplace");
  const codexZipPath = path.join(outDir, `${slug}-codex-plugin.zip`);
  const claudeZipPath = path.join(outDir, `${slug}-claude-plugin.zip`);

  await mkdir(outDir, { recursive: true });
  await Promise.all([
    rm(codexMarketplaceDir, { recursive: true, force: true }),
    rm(claudeMarketplaceDir, { recursive: true, force: true }),
    rm(codexZipPath, { force: true }),
    rm(claudeZipPath, { force: true }),
  ]);

  const codexPluginDir = path.join(codexMarketplaceDir, "plugins", slug);
  const claudePluginDir = path.join(claudeMarketplaceDir, "plugins", slug);
  await Promise.all([
    copyPreparedPlugin(codexSource, codexPluginDir),
    copyPreparedPlugin(claudeSource, claudePluginDir),
  ]);

  codexManifest.mcpServers = "./.mcp.json";
  await Promise.all([
    writeJson(
      path.join(codexPluginDir, ".codex-plugin", "plugin.json"),
      codexManifest,
    ),
    writeMcpConfig(codexPluginDir, slug, options.codex.mcpServer),
    writeMcpConfig(claudePluginDir, slug, options.claude.mcpServer),
    writeJson(
      path.join(codexMarketplaceDir, ".agents", "plugins", "marketplace.json"),
      {
        name: slug,
        interface: {
          displayName: codexManifest.interface?.displayName ?? slug,
        },
        plugins: [
          {
            name: slug,
            source: { source: "local", path: `./plugins/${slug}` },
            policy: options.codex.policy ?? {
              installation: "AVAILABLE",
              authentication: "ON_USE",
            },
            category:
              options.codex.category ??
              codexManifest.interface?.category ??
              "Developer Tools",
          },
        ],
      },
    ),
    writeJson(
      path.join(claudeMarketplaceDir, ".claude-plugin", "marketplace.json"),
      {
        name: slug,
        description: claudeManifest.description,
        owner: { name: authorName(claudeManifest.author) ?? slug },
        plugins: [
          {
            name: slug,
            source: `./plugins/${slug}`,
            description: claudeManifest.description,
            version: claudeManifest.version,
            author: { name: authorName(claudeManifest.author) ?? slug },
          },
        ],
      },
    ),
  ]);

  await Promise.all([
    writeZipArchive(codexMarketplaceDir, codexZipPath),
    writeZipArchive(claudeMarketplaceDir, claudeZipPath),
  ]);

  return {
    slug,
    codexMarketplaceDir,
    claudeMarketplaceDir,
    codexZipPath,
    claudeZipPath,
  };
}

function validateIdentity(
  codex: CodexPluginManifest,
  claude: ClaudePluginManifest,
): string {
  const slug = codex.name?.trim();
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error(`Codex plugin name must be an npm-style slug: ${codex.name}`);
  }
  if (claude.name !== slug) {
    throw new Error(
      `Codex and Claude plugin names must match: ${slug} !== ${claude.name}`,
    );
  }
  return slug;
}

function validateMcpServer(
  server: PluginMcpServer,
  platform: "codex" | "claude",
): void {
  if (server.type === "http") {
    validateMcpUrl(server.url);
    if (server.oauthResource) validateMcpUrl(server.oauthResource);
    return;
  }

  if (!server.command.trim()) {
    throw new Error(`${platform} stdio MCP command cannot be empty.`);
  }
  if (server.cwd) {
    const normalized = path.normalize(server.cwd);
    if (path.isAbsolute(normalized) || normalized.startsWith("..")) {
      throw new Error(`${platform} stdio MCP cwd must stay inside the plugin.`);
    }
  }
  const values = [server.command, ...(server.args ?? []), server.cwd ?? ""];
  if (platform === "codex" && values.some((value) => value.includes("${PLUGIN_ROOT}"))) {
    throw new Error(
      'Codex does not expand ${PLUGIN_ROOT} in MCP argv; use a relative path with cwd: ".".',
    );
  }
  if (values.some((value) => value.includes("${CLAUDE_PLUGIN_ROOT}")) && platform !== "claude") {
    throw new Error("${CLAUDE_PLUGIN_ROOT} is only valid in Claude plugin configuration.");
  }
}

function validateMcpUrl(value: string): void {
  if (value === "${SIDECAR_MCP_URL}") return;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Plugin MCP URL must be an absolute URL: ${value}`);
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    throw new Error("Plugin MCP URL must use HTTPS outside localhost.");
  }
}

function renderMcpServer(server: PluginMcpServer): Record<string, unknown> {
  if (server.type === "http") {
    return {
      type: "http",
      url: server.url,
      ...(server.oauthResource ? { oauth_resource: server.oauthResource } : {}),
    };
  }
  return {
    command: server.command,
    ...(server.args?.length ? { args: server.args } : {}),
    ...(server.cwd ? { cwd: server.cwd } : {}),
    ...(server.env && Object.keys(server.env).length ? { env: server.env } : {}),
  };
}

async function writeMcpConfig(
  pluginDir: string,
  slug: string,
  server: PluginMcpServer,
): Promise<void> {
  await writeJson(path.join(pluginDir, ".mcp.json"), {
    mcpServers: { [slug]: renderMcpServer(server) },
  });
}

async function copyPreparedPlugin(source: string, destination: string) {
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, {
    recursive: true,
    filter: safePluginCopyFilter,
  });
}

async function safePluginCopyFilter(sourcePath: string): Promise<boolean> {
  const basename = path.basename(sourcePath);
  if (
    basename === "node_modules" ||
    basename === ".git" ||
    basename === ".env" ||
    basename.startsWith(".env.")
  ) {
    return false;
  }
  return !(await lstat(sourcePath)).isSymbolicLink();
}

function authorName(author: string | { name?: string } | undefined) {
  return typeof author === "string" ? author : author?.name;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
