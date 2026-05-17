/** Static analysis for reserved MCP prompt files. */
import {
  createPromptDescriptor,
  type McpIcon,
  type PromptArgInput,
  type PromptArgsDefinition,
} from "@sidecar/core";
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
import type { SidecarPromptManifestEntry } from "./types.js";
import { existsSyncSafe, safePathSegment } from "./utils.js";

/** Finds all Sidecar prompt files under `prompts/`. */
export async function analyzeProjectPrompts(rootDir: string): Promise<SidecarPromptManifestEntry[]> {
  const promptFiles = await findPromptFiles(path.join(rootDir, "prompts"));
  if (promptFiles.length === 0) {
    return [];
  }

  const project = createProject(rootDir);
  return promptFiles.map((filePath) =>
    analyzePromptFile(project.addSourceFileAtPath(filePath), rootDir),
  );
}

/** Analyzes one `prompt.ts` source file into a compiler manifest entry. */
export function analyzePromptFile(
  sourceFile: SourceFile,
  rootDir: string,
): SidecarPromptManifestEntry {
  const definition = findPromptDefinition(sourceFile);
  const absoluteFile = sourceFile.getFilePath();
  const directory = path.basename(path.dirname(absoluteFile));
  const name = getOptionalStringProperty(definition, "name") ?? safePathSegment(directory);
  const title = getRequiredStringProperty(definition, "title", sourceFile);
  const description = getOptionalStringProperty(definition, "description");
  const args = readArgs(definition);
  const descriptor = createPromptDescriptor({
    name,
    title,
    description,
    args,
    icons: readIcons(definition),
  });

  if (!getMethodOrFunctionProperty(definition, "run")) {
    throw new CompilerError(sourceFile, "prompt({ ... }) must include a run method.");
  }

  return {
    sourceFile: path.relative(rootDir, absoluteFile),
    directory,
    name,
    title,
    description,
    args,
    descriptor,
  };
}

/** Finds immediate `prompts/<name>/prompt.ts` files in deterministic order. */
async function findPromptFiles(promptsDir: string): Promise<string[]> {
  if (!existsSyncSafe(promptsDir)) {
    return [];
  }

  const entries = await readdir(promptsDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const filePath = path.join(promptsDir, entry.name, "prompt.ts");
    if (existsSyncSafe(filePath)) {
      files.push(filePath);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

/** Locates the default-exported `prompt({ ... })` object literal. */
function findPromptDefinition(sourceFile: SourceFile): ObjectLiteralExpression {
  const call = resolveDefaultExportCall(sourceFile, "prompt");
  if (!call) {
    throw new CompilerError(
      sourceFile,
      "prompt.ts must default-export prompt({ ... }) or an identifier initialized with prompt({ ... }).",
    );
  }

  const definition = unwrapExpression(call.getArguments()[0]);
  if (!definition || !Node.isObjectLiteralExpression(definition)) {
    throw new CompilerError(sourceFile, "prompt(...) must receive one object literal.");
  }
  return definition;
}

/** Reads a required string property from the prompt object. */
function getRequiredStringProperty(
  definition: ObjectLiteralExpression,
  propertyName: string,
  sourceFile: SourceFile,
): string {
  const value = getOptionalStringProperty(definition, propertyName);
  if (value === undefined || !value.trim()) {
    throw new CompilerError(
      sourceFile,
      `prompt({ ... }) must include a non-empty ${propertyName} string.`,
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

/** Reads `args` into prompt argument descriptors. */
function readArgs(definition: ObjectLiteralExpression): PromptArgsDefinition | undefined {
  const initializer = readObjectProperty(definition, "args");
  if (!initializer) {
    return undefined;
  }

  const args: PromptArgsDefinition = {};
  for (const property of initializer.getProperties()) {
    if (!Node.isPropertyAssignment(property)) {
      continue;
    }
    const value = readArgInput(property.getInitializer());
    if (value !== undefined) {
      args[property.getName().replace(/^["']|["']$/g, "")] = value;
    }
  }
  return Object.keys(args).length ? args : undefined;
}

/** Reads one supported prompt arg declaration. */
function readArgInput(node: Node | undefined): PromptArgInput | undefined {
  const initializer = unwrapExpression(node);
  if (!initializer) {
    return undefined;
  }
  if (Node.isStringLiteral(initializer)) {
    return initializer.getLiteralText();
  }
  if (Node.isArrayLiteralExpression(initializer)) {
    return initializer
      .getElements()
      .filter(Node.isLiteralExpression)
      .map((element) => element.getLiteralText());
  }
  if (Node.isObjectLiteralExpression(initializer)) {
    return {
      description: getOptionalStringProperty(initializer, "description"),
      required: readBooleanProperty(initializer, "required"),
    };
  }
  return undefined;
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
