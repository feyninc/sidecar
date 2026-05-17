/** Project identity loading for generated manifests and plugin packages. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { toMachineName } from "@sidecar-ai/core";
import type { ProjectIdentity } from "./types.js";
import { existsSyncSafe } from "./utils.js";

/** Loads project name, slug, version, and description from config/package metadata. */
export async function loadProjectIdentity(
  rootDir: string,
): Promise<ProjectIdentity> {
  const packageJson = await readOptionalJson(path.join(rootDir, "package.json"));
  const configText = await readOptionalText(
    path.join(rootDir, "sidecar.config.ts"),
  );
  const name =
    readConfigString(configText, "name") ??
    packageJson?.name ??
    path.basename(rootDir);
  const version =
    readConfigString(configText, "version") ??
    packageJson?.version ??
    "0.0.0-dev";
  const description =
    readConfigString(configText, "description") ??
    packageJson?.description ??
    `${name} Sidecar app.`;

  return {
    name,
    slug: toMachineName(name).replaceAll("_", "-"),
    version,
    description,
  };
}

/** Reads JSON when the file exists. */
async function readOptionalJson(
  filePath: string,
): Promise<Record<string, string> | undefined> {
  if (!existsSyncSafe(filePath)) {
    return undefined;
  }

  return JSON.parse(await readFile(filePath, "utf8")) as Record<string, string>;
}

/** Reads text when the file exists. */
async function readOptionalText(filePath: string): Promise<string | undefined> {
  if (!existsSyncSafe(filePath)) {
    return undefined;
  }

  return readFile(filePath, "utf8");
}

/** Extracts a simple string property from `sidecar.config.ts` without executing it. */
function readConfigString(
  configText: string | undefined,
  key: string,
): string | undefined {
  if (!configText) {
    return undefined;
  }

  const match = configText.match(
    new RegExp(`${key}\\s*:\\s*["'\`]([^"'\`]+)["'\`]`),
  );
  return match?.[1];
}
