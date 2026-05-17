#!/usr/bin/env node
/**
 * Copies root tsup output into package-local dist folders for npm publishing.
 *
 * The repository builds all entrypoints through one tsup config so shared
 * externals stay consistent. Published packages still need self-contained
 * `dist` folders because npm package exports cannot point outside the package.
 */
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const packageOutputs = [
  "anthropic",
  "auth",
  "cli",
  "client",
  "compiler",
  "core",
  "create-sidecar-app",
  "native",
  "openai",
  "react",
  "server",
];

for (const packageName of packageOutputs) {
  const sourceDir = path.join(repoRoot, "dist", packageName);
  const outputDir = path.join(repoRoot, "packages", packageName, "dist");

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(path.dirname(outputDir), { recursive: true });
  await cp(sourceDir, outputDir, { recursive: true });
}

await cp(
  path.join(repoRoot, "packages", "native", "src", "styles.css"),
  path.join(repoRoot, "packages", "native", "dist", "styles.css"),
);
