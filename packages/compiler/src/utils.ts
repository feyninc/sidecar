import { existsSync } from "node:fs";
import path from "node:path";

export function existsSyncSafe(filePath: string): boolean {
  return existsSync(filePath);
}

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

export function toIdentifier(value: string): string {
  const identifier = value
    .replace(/[^A-Za-z0-9]+(.)/g, (_match, char: string) => char.toUpperCase())
    .replace(/^[^A-Za-z_$]+/, "")
    .replace(/[^A-Za-z0-9_$]/g, "");

  return identifier || "tool";
}

export function safePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_");
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

export function readObjectString(source: string, key: string): string | undefined {
  const match = source.match(
    new RegExp(`${key}\\s*:\\s*(["'\`])([\\s\\S]*?)\\1`),
  );
  return match?.[2]?.trim();
}

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
