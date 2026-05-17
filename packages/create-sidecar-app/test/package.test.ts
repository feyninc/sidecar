/** Tests for publish-facing package metadata. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const packageNames = [
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
] as const;

describe("package metadata", () => {
  it("points public exports and bins at built JavaScript", async () => {
    for (const packageName of packageNames) {
      const manifest = await readPackageJson(packageName);

      expect(JSON.stringify(manifest.exports)).not.toContain("./src/");
      expect(manifest.types).toMatch(/^\.\/dist\/.+\.d\.ts$/);

      for (const binPath of Object.values(manifest.bin ?? {})) {
        expect(binPath).toMatch(/^\.\/dist\/.+\.js$/);
      }
    }
  });
});

type PackageJson = {
  exports?: unknown;
  types?: string;
  bin?: Record<string, string>;
};

/** Reads a workspace package manifest by package directory name. */
async function readPackageJson(packageName: string): Promise<PackageJson> {
  const filePath = path.resolve(
    import.meta.dirname,
    "..",
    "..",
    packageName,
    "package.json",
  );
  return JSON.parse(await readFile(filePath, "utf8")) as PackageJson;
}
