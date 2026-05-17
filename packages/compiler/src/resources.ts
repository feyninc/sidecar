/** Static analysis for reserved MCP resource files. */
import {
  createResourceDescriptor,
  type McpIcon,
  type McpResourceDescriptor,
  type ResourceAnnotations,
} from "@sidecar-ai/core";
import { readdir } from "node:fs/promises";
import path from "node:path";
import {
  Node,
  SyntaxKind,
  type ObjectLiteralExpression,
  type SourceFile,
} from "ts-morph";
import { resolveDefaultExportCall, unwrapExpression } from "./ast.js";
import { CompilerError } from "./errors.js";
import { createProject } from "./project.js";
import type { SidecarResourceManifestEntry } from "./types.js";
import { existsSyncSafe, safePathSegment } from "./utils.js";

/** Finds all Sidecar resource files under `resources/`. */
export async function analyzeProjectResources(rootDir: string): Promise<SidecarResourceManifestEntry[]> {
  const resourceFiles = await findResourceFiles(path.join(rootDir, "resources"));
  if (resourceFiles.length === 0) {
    return [];
  }

  const project = createProject(rootDir);
  return resourceFiles.map((filePath) =>
    analyzeResourceFile(project.addSourceFileAtPath(filePath), rootDir),
  );
}

/** Analyzes one `resource.ts` source file into a compiler manifest entry. */
export function analyzeResourceFile(
  sourceFile: SourceFile,
  rootDir: string,
): SidecarResourceManifestEntry {
  const definition = findResourceDefinition(sourceFile);
  const absoluteFile = sourceFile.getFilePath();
  const directory = path.basename(path.dirname(absoluteFile));
  const defaultUri = `sidecar://resources/${safePathSegment(directory)}`;
  const name = getRequiredStringProperty(definition, "name", sourceFile);
  const uri = getOptionalStringProperty(definition, "uri") ?? defaultUri;
  const descriptor = createResourceDescriptor({
    uri,
    name,
    title: getOptionalStringProperty(definition, "title"),
    description: getOptionalStringProperty(definition, "description"),
    mimeType: getOptionalStringProperty(definition, "mimeType"),
    size: getOptionalNumberProperty(definition, "size"),
    icons: readIcons(definition),
    annotations: readAnnotations(definition),
  });

  if (!getMethodOrFunctionProperty(definition, "read")) {
    throw new CompilerError(sourceFile, "resource({ ... }) must include a read method.");
  }

  return {
    sourceFile: path.relative(rootDir, absoluteFile),
    directory,
    uri,
    name,
    title: descriptor.title,
    description: descriptor.description,
    mimeType: descriptor.mimeType,
    size: descriptor.size,
    annotations: descriptor.annotations,
    subscribe: readBooleanProperty(definition, "subscribe"),
    descriptor,
  };
}

/** Finds immediate `resources/<name>/resource.ts` files in deterministic order. */
async function findResourceFiles(resourcesDir: string): Promise<string[]> {
  if (!existsSyncSafe(resourcesDir)) {
    return [];
  }

  const entries = await readdir(resourcesDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const filePath = path.join(resourcesDir, entry.name, "resource.ts");
    if (existsSyncSafe(filePath)) {
      files.push(filePath);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

/** Locates the default-exported `resource({ ... })` object literal. */
function findResourceDefinition(sourceFile: SourceFile): ObjectLiteralExpression {
  const call = resolveDefaultExportCall(sourceFile, "resource");
  if (!call) {
    throw new CompilerError(
      sourceFile,
      "resource.ts must default-export resource({ ... }) or an identifier initialized with resource({ ... }).",
    );
  }

  const definition = unwrapExpression(call.getArguments()[0]);
  if (!definition || !Node.isObjectLiteralExpression(definition)) {
    throw new CompilerError(sourceFile, "resource(...) must receive one object literal.");
  }
  return definition;
}

/** Reads a required string property from the resource object. */
function getRequiredStringProperty(
  definition: ObjectLiteralExpression,
  propertyName: string,
  sourceFile: SourceFile,
): string {
  const value = getOptionalStringProperty(definition, propertyName);
  if (value === undefined || !value.trim()) {
    throw new CompilerError(
      sourceFile,
      `resource({ ... }) must include a non-empty ${propertyName} string.`,
    );
  }
  return value;
}

/** Reads an optional string literal property. */
function getOptionalStringProperty(
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

/** Reads an optional number literal property. */
function getOptionalNumberProperty(
  definition: ObjectLiteralExpression,
  propertyName: string,
): number | undefined {
  const property = definition.getProperty(propertyName);
  if (!property || !Node.isPropertyAssignment(property)) {
    return undefined;
  }
  const initializer = unwrapExpression(property.getInitializer());
  return initializer && Node.isNumericLiteral(initializer)
    ? Number(initializer.getLiteralText())
    : undefined;
}

/** Reads an optional boolean literal property. */
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

/** Reads a supported method/function property without executing code. */
function getMethodOrFunctionProperty(
  definition: ObjectLiteralExpression,
  propertyName: string,
): Node | undefined {
  const property = definition.getProperty(propertyName);
  if (Node.isMethodDeclaration(property)) {
    return property;
  }
  if (property && Node.isPropertyAssignment(property)) {
    const initializer = property.getInitializer();
    if (
      initializer &&
      (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))
    ) {
      return initializer;
    }
  }
  return undefined;
}

/** Extracts static MCP annotations from the resource object. */
function readAnnotations(
  definition: ObjectLiteralExpression,
): ResourceAnnotations | undefined {
  const initializer = readObjectProperty(definition, "annotations");
  if (!initializer) {
    return undefined;
  }

  const annotations: ResourceAnnotations = {};
  const audience = readStringArrayProperty(initializer, "audience")
    ?.filter((value): value is "user" | "assistant" => value === "user" || value === "assistant");
  const priority = getOptionalNumberProperty(initializer, "priority");
  const lastModified = getOptionalStringProperty(initializer, "lastModified");
  if (audience?.length) annotations.audience = audience;
  if (priority !== undefined) annotations.priority = priority;
  if (lastModified) annotations.lastModified = lastModified;
  return Object.keys(annotations).length ? annotations : undefined;
}

/** Reads MCP icon metadata from a simple object array. */
function readIcons(definition: ObjectLiteralExpression): McpIcon[] | undefined {
  const property = definition.getProperty("icons");
  if (!property || !Node.isPropertyAssignment(property)) {
    return undefined;
  }
  const initializer = unwrapExpression(property.getInitializer());
  if (!initializer || !Node.isArrayLiteralExpression(initializer)) {
    return undefined;
  }

  const icons = initializer.getElements().flatMap((element) => {
    const object = unwrapExpression(element);
    if (!object || !Node.isObjectLiteralExpression(object)) {
      return [];
    }
    const src = getOptionalStringProperty(object, "src");
    if (!src) {
      return [];
    }
    return [{
      src,
      mimeType: getOptionalStringProperty(object, "mimeType"),
      sizes: readStringArrayProperty(object, "sizes"),
    }];
  });
  return icons.length ? icons : undefined;
}

/** Reads a nested object literal property. */
function readObjectProperty(
  definition: ObjectLiteralExpression,
  propertyName: string,
): ObjectLiteralExpression | undefined {
  const property = definition.getProperty(propertyName);
  if (!property || !Node.isPropertyAssignment(property)) {
    return undefined;
  }
  const initializer = unwrapExpression(property.getInitializer());
  return initializer && Node.isObjectLiteralExpression(initializer)
    ? initializer
    : undefined;
}

/** Reads a string literal array property. */
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
  return initializer
    .getElements()
    .filter(Node.isStringLiteral)
    .map((element) => element.getLiteralText());
}
