#!/usr/bin/env node
/**
 * Publishes Sidecar's npm packages in dependency order.
 *
 * The release workflow uses npm trusted publishing, so this script intentionally
 * does not read or require an npm token. In GitHub Actions, npm authenticates via
 * OIDC when each package has this workflow configured as a trusted publisher.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const packageDirs = [
  "packages/core",
  "packages/auth",
  "packages/client",
  "packages/native",
  "packages/react",
  "packages/server",
  "packages/compiler",
  "packages/cli",
  "packages/openai",
  "packages/anthropic",
  "packages/sidecar-ai",
  "packages/create-sidecar-app",
];

const options = parseArgs(process.argv.slice(2));

for (const packageDir of packageDirs) {
  const absolutePackageDir = path.join(repoRoot, packageDir);
  const packageJson = readPackageJson(absolutePackageDir);

  if (packageJson.private) {
    console.log(`Skipping private package ${packageJson.name}.`);
    continue;
  }

  if (packageIsPublished(packageJson.name, packageJson.version)) {
    console.log(`Skipping ${packageJson.name}@${packageJson.version}; it is already published.`);
    continue;
  }

  publishPackage(absolutePackageDir, packageJson.name, packageJson.version, options);
}

/** Parses CLI flags accepted by the release script. */
function parseArgs(args) {
  const parsed = {
    dryRun: false,
    tag: "latest",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (arg === "--tag") {
      parsed.tag = readRequiredValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--tag=")) {
      parsed.tag = arg.slice("--tag=".length);
      continue;
    }
    throw new Error(`Unknown release flag: ${arg}`);
  }

  if (!/^[a-zA-Z0-9._-]+$/.test(parsed.tag)) {
    throw new Error(`Invalid npm dist-tag: ${parsed.tag}`);
  }

  return parsed;
}

/** Reads the next CLI argument for a flag that requires a value. */
function readRequiredValue(args, index, flagName) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flagName} requires a value.`);
  }
  return value;
}

/** Reads a package manifest from a package directory. */
function readPackageJson(packageDir) {
  return JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8"));
}

/** Returns true when the exact package version already exists on npm. */
function packageIsPublished(packageName, version) {
  const result = spawnSync("npm", ["view", `${packageName}@${version}`, "version", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  if (result.status === 0) {
    return JSON.parse(result.stdout) === version;
  }

  const output = `${result.stdout}\n${result.stderr}`;
  if (output.includes("E404") || output.includes("404 Not Found")) {
    return false;
  }

  throw new Error(`Could not check published version for ${packageName}@${version}:\n${output}`);
}

/** Publishes one package using npm's current registry authentication context. */
function publishPackage(packageDir, packageName, version, options) {
  const args = ["publish", "--access", "public", "--tag", options.tag];

  if (options.dryRun) {
    args.push("--dry-run");
  }

  console.log(`Publishing ${packageName}@${version} with dist-tag "${options.tag}".`);

  const result = spawnSync("npm", args, {
    cwd: packageDir,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`Failed to publish ${packageName}@${version}.`);
  }
}
