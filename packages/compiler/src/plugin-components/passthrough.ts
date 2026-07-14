/** Claude plugin directory passthrough helpers. */
import { cp, lstat } from "node:fs/promises";
import path from "node:path";
import { existsSyncSafe } from "../utils.js";

/** Copies Claude-specific directories that Sidecar does not transform yet. */
export async function copyClaudePassthroughDirectories(
  rootDir: string,
  pluginDir: string,
): Promise<void> {
  for (const directory of [
    "assets",
    "bin",
    "monitors",
    "output-styles",
    "themes",
  ]) {
    const source = path.join(rootDir, directory);
    if (!existsSyncSafe(source)) {
      continue;
    }

    await cp(source, path.join(pluginDir, directory), {
      recursive: true,
      filter: safePluginCopyFilter,
    });
  }
}

/** Copies portable files understood by Codex plugins. */
export async function copyCodexPassthroughDirectories(
  rootDir: string,
  pluginDir: string,
): Promise<void> {
  for (const directory of ["assets", "bin"]) {
    const source = path.join(rootDir, directory);
    if (!existsSyncSafe(source)) continue;
    await cp(source, path.join(pluginDir, directory), {
      recursive: true,
      filter: safePluginCopyFilter,
    });
  }
}

/** Avoids accidentally packaging symlinks, env files, or package managers' metadata. */
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

  const stat = await lstat(sourcePath);
  return !stat.isSymbolicLink();
}
