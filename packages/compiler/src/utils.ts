/** Shared compiler utility helpers. */
import { existsSync } from "node:fs";
import path from "node:path";

/** Safe filesystem existence check wrapped for testability and consistency. */
export function existsSyncSafe(filePath: string): boolean {
  return existsSync(filePath);
}

/** Creates an ESM import specifier from one file location to another. */
export function toImportSpecifier(
  fromDir: string,
  toFile: string,
  options: { extension?: "none" | "js" | "preserve" } = {},
): string {
  const relative = path.relative(fromDir, toFile).replaceAll(path.sep, "/");
  const normalized = relative.startsWith(".") ? relative : `./${relative}`;

  switch (options.extension ?? "none") {
    case "js":
      return normalized.replace(/\.(tsx|ts)$/, ".js");
    case "preserve":
      return normalized;
    case "none":
      return normalized.replace(/\.(tsx|ts)$/, "");
  }
}

/** Converts a tool id into a valid JavaScript property identifier. */
export function toIdentifier(value: string): string {
  const identifier = value
    .replace(/[^A-Za-z0-9]+(.)/g, (_match, char: string) => char.toUpperCase())
    .replace(/^[^A-Za-z_$]+/, "")
    .replace(/[^A-Za-z0-9_$]/g, "");

  return identifier || "tool";
}

/** Sanitizes a value for use as a path segment. */
export function safePathSegment(value: string): string {
  const segment = value.replace(/[^A-Za-z0-9._-]+/g, "_");
  if (!segment || segment === "." || segment === "..") {
    return "_";
  }
  return segment;
}

/** Sanitizes a metadata-provided file stem for generated plugin files. */
export function safeFileStem(value: string): string {
  return safePathSegment(value).replace(/^\.+/, "_").replace(/^_+/, "_");
}

/** Escapes a scalar value for simple YAML/frontmatter generation. */
export function yamlScalar(value: unknown): string {
  return JSON.stringify(String(value ?? ""));
}

/** Escapes text that will be embedded into HTML. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Drops undefined values from JSON-like objects before writing files. */
export function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

/** Reads a simple string property from a TypeScript object literal string. */
export function readObjectString(source: string, key: string): string | undefined {
  const match = source.match(
    new RegExp(`${key}\\s*:\\s*(["'\`])([\\s\\S]*?)\\1`),
  );
  return match?.[2]?.trim();
}

/** Reads a simple string array property from a TypeScript object literal string. */
export function readObjectStringArray(
  source: string,
  key: string,
): string[] | undefined {
  const match = source.match(new RegExp(`${key}\\s*:\\s*\\[([\\s\\S]*?)\\]`));
  if (!match?.[1]) {
    return undefined;
  }

  return [...match[1].matchAll(/["']([^"']+)["']/g)]
    .map((item) => item[1]!)
    .filter(Boolean);
}
