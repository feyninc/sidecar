import { cp } from "node:fs/promises";
import path from "node:path";
import { existsSyncSafe } from "../utils.js";

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

    await cp(source, path.join(pluginDir, directory), { recursive: true });
  }
}
