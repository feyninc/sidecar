#!/usr/bin/env node
/**
 * Copies root tsup output into package-local dist folders for npm publishing.
 *
 * The repository builds all entrypoints through one tsup config so shared
 * externals stay consistent. Published packages still need self-contained
 * `dist` folders because npm package exports cannot point outside the package.
 */
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
  "sidecar-ai",
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

const declarationImportRewrites = new Map([
  ["../anthropic/index.js", "@sidecar-ai/anthropic"],
  ["../auth/index.js", "@sidecar-ai/auth"],
  ["../client/index.js", "@sidecar-ai/client"],
  ["../compiler/index.js", "@sidecar-ai/compiler"],
  ["../core/index.js", "@sidecar-ai/core"],
  ["../native/components/index.js", "@sidecar-ai/native/components"],
  ["../native/index.js", "@sidecar-ai/native"],
  ["../openai/index.js", "@sidecar-ai/openai"],
  ["../react/index.js", "@sidecar-ai/react"],
  ["../server/index.js", "@sidecar-ai/server"],
]);

for (const packageName of packageOutputs) {
  await rewriteDeclarations(path.join(repoRoot, "packages", packageName, "dist"));
}

/** Rewrites monorepo-relative declaration imports to published package names. */
async function rewriteDeclarations(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await rewriteDeclarations(entryPath);
        return;
      }
      if (!entry.name.endsWith(".d.ts")) {
        return;
      }

      const before = await readFile(entryPath, "utf8");
      let after = before;
      for (const [from, to] of declarationImportRewrites) {
        after = after.replaceAll(from, to);
      }
      if (after !== before) {
        await writeFile(entryPath, after);
      }
    }),
  );
}
