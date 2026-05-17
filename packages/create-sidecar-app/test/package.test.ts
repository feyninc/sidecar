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
  "sidecar-ai",
] as const;

describe("package metadata", () => {
  it("points public exports and bins at built JavaScript", async () => {
    for (const packageName of packageNames) {
      const manifest = await readPackageJson(packageName);

      expect(JSON.stringify(manifest.exports)).not.toContain("./src/");
      expect(manifest.types).toMatch(/^\.\/dist\/.+\.d\.ts$/);
      expect(manifest.files).toContain("dist");

      for (const binPath of Object.values(manifest.bin ?? {})) {
        expect(binPath).toMatch(/^dist\/.+\.js$/);
      }
    }
  });

  it("installs the official OpenAI UI SDK with the OpenAI package", async () => {
    const manifest = await readPackageJson("openai");

    expect(manifest.dependencies).toMatchObject({
      "@openai/apps-sdk-ui": "^0.2.2"
    });
    expect(manifest.peerDependencies ?? {}).not.toHaveProperty("@openai/apps-sdk-ui");
    expect(manifest.peerDependenciesMeta ?? {}).not.toHaveProperty("@openai/apps-sdk-ui");
  });
});

type PackageJson = {
  dependencies?: Record<string, string>;
  exports?: unknown;
  files?: string[];
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
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
