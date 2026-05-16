/** Hook passthrough for plugin packages. */
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { existsSyncSafe } from "../utils.js";

/** Copies root hook config into a plugin package when present. */
export async function copyHooks(
  rootDir: string,
  destination: string,
): Promise<void> {
  const candidates = [
    path.join(rootDir, "hooks.json"),
    path.join(rootDir, "hooks", "hooks.json"),
  ];
  const source = candidates.find(existsSyncSafe);
  if (!source) {
    return;
  }

  await mkdir(destination, { recursive: true });
  await cp(source, path.join(destination, "hooks.json"));
}
