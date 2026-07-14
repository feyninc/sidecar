/** Static Sidecar config extraction for build manifests. */
import path from "node:path";
import {
  Node,
  SyntaxKind,
  type ObjectLiteralExpression,
} from "ts-morph";
import { resolveDefaultExportCall, unwrapExpression } from "./ast.js";
import { createProject } from "./project.js";
import type { SidecarCompilerConfig } from "./types.js";
import { existsSyncSafe } from "./utils.js";
import type { WidgetBuildConfig, WidgetEsbuildConfig } from "@sidecar-ai/core";
import type { CodeModeRenderStrategy } from "@sidecar-ai/core";

/** Reads the serializable subset of `sidecar.config.ts` without executing app code. */
export function analyzeProjectConfig(rootDir: string): SidecarCompilerConfig {
  const configPath = path.join(rootDir, "sidecar.config.ts");
  if (!existsSyncSafe(configPath)) {
    return defaultCompilerConfig();
  }

  const project = createProject(rootDir);
  const sourceFile = project.addSourceFileAtPath(configPath);
  const call = resolveDefaultExportCall(sourceFile, "defineConfig");
  const definition = unwrapExpression(call?.getArguments()[0]);
  if (!definition || !Node.isObjectLiteralExpression(definition)) {
    return defaultCompilerConfig();
  }

  return {
    build: {
      target: readTargetNested(definition, "build", "target"),
      host: readHostNested(definition, "build", "host"),
      outDir: readStringNested(definition, "build", "outDir"),
      plugins: readBooleanNested(definition, "build", "plugins"),
      pluginMcpUrl: readStringNested(definition, "build", "pluginMcpUrl"),
      widgets: readWidgetBuildConfig(definition),
    },
    resources: {
      subscribe: readBooleanNested(definition, "resources", "subscribe") ?? false,
      listChanged: readBooleanNested(definition, "resources", "listChanged") ?? false,
    },
    prompts: {
      listChanged: readBooleanNested(definition, "prompts", "listChanged") ?? false,
    },
    tools: {
      listChanged: readBooleanNested(definition, "tools", "listChanged") ?? false,
    },
    pagination: {
      pageSize: readNumberNested(definition, "pagination", "pageSize") ?? 50,
      hasOverride: hasProperty(readObjectProperty(definition, "pagination"), "override"),
    },
    codeMode: readCodeModeConfig(definition),
    remoteExecution: {
      enabled: readBooleanProperty(definition, "remoteExecution") ?? false,
    },
  };
}

/** Reads static widget bundler options from `build.widgets`. */
function readWidgetBuildConfig(
  definition: ObjectLiteralExpression,
): WidgetBuildConfig | undefined {
  const widgets = readObjectProperty(readObjectProperty(definition, "build"), "widgets");
  if (!widgets) {
    return undefined;
  }

  const config: WidgetBuildConfig = {};
  const configure = readStringProperty(widgets, "configure");
  const esbuild = readWidgetEsbuildConfig(widgets);
  if (configure) config.configure = configure;
  if (esbuild) config.esbuild = esbuild;
  return Object.keys(config).length ? config : undefined;
}

/** Reads the serializable esbuild option subset from `build.widgets.esbuild`. */
function readWidgetEsbuildConfig(
  widgets: ObjectLiteralExpression,
): WidgetEsbuildConfig | undefined {
  const esbuild = readObjectProperty(widgets, "esbuild");
  if (!esbuild) {
    return undefined;
  }

  const config: WidgetEsbuildConfig = {};
  const alias = readStringRecordProperty(esbuild, "alias");
  const define = readStringRecordProperty(esbuild, "define");
  const external = readStringArrayProperty(esbuild, "external");
  const loader = readStringRecordProperty(esbuild, "loader");
  const conditions = readStringArrayProperty(esbuild, "conditions");
  const mainFields = readStringArrayProperty(esbuild, "mainFields");
  const jsx = readStringProperty(esbuild, "jsx");
  const jsxImportSource = readStringProperty(esbuild, "jsxImportSource");

  if (alias) config.alias = alias;
  if (define) config.define = define;
  if (external) config.external = external;
  if (loader) config.loader = loader;
  if (conditions) config.conditions = conditions;
  if (mainFields) config.mainFields = mainFields;
  if (jsx === "automatic" || jsx === "transform" || jsx === "preserve") {
    config.jsx = jsx;
  }
  if (jsxImportSource) config.jsxImportSource = jsxImportSource;

  return Object.keys(config).length ? config : undefined;
}

/** Returns compiler defaults when config is absent. */
export function defaultCompilerConfig(): SidecarCompilerConfig {
  return {
    build: {},
    resources: {
      subscribe: false,
      listChanged: false,
    },
    prompts: {
      listChanged: false,
    },
    tools: {
      listChanged: false,
    },
    pagination: {
      pageSize: 50,
      hasOverride: false,
    },
    codeMode: {
      enabled: false,
      unsafe: false,
      render: {
        enabled: true,
        strategy: "last-renderable",
      },
    },
    remoteExecution: {
      enabled: false,
    },
  };
}

/** Reads normalized code-mode settings from the top-level config object. */
function readCodeModeConfig(definition: ObjectLiteralExpression): SidecarCompilerConfig["codeMode"] {
  const defaults = defaultCompilerConfig().codeMode;
  const property = definition.getProperty("codeMode");
  if (!property || !Node.isPropertyAssignment(property)) {
    return defaults;
  }

  const initializer = unwrapExpression(property.getInitializer());
  if (!initializer) {
    return defaults;
  }
  if (initializer.getKind() === SyntaxKind.TrueKeyword) {
    return { ...defaults, enabled: true };
  }
  if (initializer.getKind() === SyntaxKind.FalseKeyword) {
    return { ...defaults, enabled: false };
  }
  if (!Node.isObjectLiteralExpression(initializer)) {
    return defaults;
  }

  return {
    enabled: true,
    unsafe: readBooleanProperty(initializer, "unsafe") ?? false,
    render: readCodeModeRenderConfig(initializer) ?? defaults.render,
  };
}

/** Reads `codeMode.render`, accepting a boolean or options object. */
function readCodeModeRenderConfig(
  definition: ObjectLiteralExpression,
): SidecarCompilerConfig["codeMode"]["render"] | undefined {
  const property = definition.getProperty("render");
  if (!property || !Node.isPropertyAssignment(property)) {
    return undefined;
  }

  const initializer = unwrapExpression(property.getInitializer());
  if (!initializer) {
    return undefined;
  }
  if (initializer.getKind() === SyntaxKind.TrueKeyword) {
    return { enabled: true, strategy: "last-renderable" };
  }
  if (initializer.getKind() === SyntaxKind.FalseKeyword) {
    return { enabled: false, strategy: "last-renderable" };
  }
  if (!Node.isObjectLiteralExpression(initializer)) {
    return undefined;
  }

  return {
    enabled: readBooleanProperty(initializer, "enabled") ?? true,
    strategy: readRenderStrategy(initializer) ?? "last-renderable",
  };
}

/** Reads a supported code-mode render strategy string. */
function readRenderStrategy(
  definition: ObjectLiteralExpression,
): CodeModeRenderStrategy | undefined {
  const value = readStringProperty(definition, "strategy");
  if (
    value === "last-renderable" ||
    value === "first-renderable" ||
    value === "explicit"
  ) {
    return value;
  }
  return undefined;
}

/** Reads a build target nested object property. */
function readTargetNested(
  definition: ObjectLiteralExpression,
  section: string,
  propertyName: string,
): "mcp" | "chatgpt" | "claude" | undefined {
  const value = readStringNested(definition, section, propertyName);
  return value === "mcp" || value === "chatgpt" || value === "claude"
    ? value
    : undefined;
}

/** Reads a build host nested object property. */
function readHostNested(
  definition: ObjectLiteralExpression,
  section: string,
  propertyName: string,
): "node" | "vercel" | undefined {
  const value = readStringNested(definition, section, propertyName);
  return value === "node" || value === "vercel" ? value : undefined;
}

/** Reads a string nested object property. */
function readStringNested(
  definition: ObjectLiteralExpression,
  section: string,
  propertyName: string,
): string | undefined {
  const object = readObjectProperty(definition, section);
  if (!object) {
    return undefined;
  }
  return readStringProperty(object, propertyName);
}

/** Reads a boolean nested object property. */
function readBooleanNested(
  definition: ObjectLiteralExpression,
  section: string,
  propertyName: string,
): boolean | undefined {
  const object = readObjectProperty(definition, section);
  if (!object) {
    return undefined;
  }
  return readBooleanProperty(object, propertyName);
}

/** Reads a boolean object property. */
function readBooleanProperty(
  definition: ObjectLiteralExpression,
  propertyName: string,
): boolean | undefined {
  const property = definition.getProperty(propertyName);
  if (!property || !Node.isPropertyAssignment(property)) {
    return undefined;
  }
  const initializer = unwrapExpression(property.getInitializer());
  if (!initializer) {
    return undefined;
  }
  if (initializer.getKind() === SyntaxKind.TrueKeyword) return true;
  if (initializer.getKind() === SyntaxKind.FalseKeyword) return false;
  return undefined;
}

/** Reads a number nested object property. */
function readNumberNested(
  definition: ObjectLiteralExpression,
  section: string,
  propertyName: string,
): number | undefined {
  const object = readObjectProperty(definition, section);
  if (!object) {
    return undefined;
  }
  const property = object.getProperty(propertyName);
  if (!property || !Node.isPropertyAssignment(property)) {
    return undefined;
  }
  const initializer = unwrapExpression(property.getInitializer());
  return initializer && Node.isNumericLiteral(initializer)
    ? Number(initializer.getLiteralText())
    : undefined;
}

/** Reads a nested object literal property. */
function readObjectProperty(
  definition: ObjectLiteralExpression | undefined,
  propertyName: string,
): ObjectLiteralExpression | undefined {
  if (!definition) {
    return undefined;
  }
  const property = definition.getProperty(propertyName);
  if (!property || !Node.isPropertyAssignment(property)) {
    return undefined;
  }
  const initializer = unwrapExpression(property.getInitializer());
  return initializer && Node.isObjectLiteralExpression(initializer)
    ? initializer
    : undefined;
}

/** Reads one string property from an object literal. */
function readStringProperty(
  definition: ObjectLiteralExpression,
  propertyName: string,
): string | undefined {
  const property = definition.getProperty(propertyName);
  if (!property || !Node.isPropertyAssignment(property)) {
    return undefined;
  }
  const initializer = unwrapExpression(property.getInitializer());
  return initializer && Node.isStringLiteral(initializer)
    ? initializer.getLiteralText()
    : undefined;
}

/** Reads a string array property from an object literal. */
function readStringArrayProperty(
  definition: ObjectLiteralExpression,
  propertyName: string,
): string[] | undefined {
  const property = definition.getProperty(propertyName);
  if (!property || !Node.isPropertyAssignment(property)) {
    return undefined;
  }
  const initializer = unwrapExpression(property.getInitializer());
  if (!initializer || !Node.isArrayLiteralExpression(initializer)) {
    return undefined;
  }

  const values = initializer.getElements().map((element) => {
    const unwrapped = unwrapExpression(element);
    return unwrapped && Node.isStringLiteral(unwrapped)
      ? unwrapped.getLiteralText()
      : undefined;
  });
  return values.every((value): value is string => value !== undefined)
    ? values
    : undefined;
}

/** Reads a string-valued object property from an object literal. */
function readStringRecordProperty(
  definition: ObjectLiteralExpression,
  propertyName: string,
): Record<string, string> | undefined {
  const object = readObjectProperty(definition, propertyName);
  if (!object) {
    return undefined;
  }

  const record: Record<string, string> = {};
  for (const property of object.getProperties()) {
    if (!Node.isPropertyAssignment(property)) {
      return undefined;
    }
    const initializer = unwrapExpression(property.getInitializer());
    if (!initializer || !Node.isStringLiteral(initializer)) {
      return undefined;
    }
    record[property.getName().replace(/^["']|["']$/g, "")] = initializer.getLiteralText();
  }
  return record;
}

/** Returns true when an object literal has the named property. */
function hasProperty(
  definition: ObjectLiteralExpression | undefined,
  propertyName: string,
): boolean {
  return Boolean(definition?.getProperty(propertyName));
}
