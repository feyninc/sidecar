/** Static analysis for reserved server tool files. */
import {
  createToolDescriptor,
  toMachineName,
  type ToolAnnotations,
} from "@sidecar/core";
import { readdir } from "node:fs/promises";
import path from "node:path";
import {
  ModuleKind,
  ModuleResolutionKind,
  Node,
  Project,
  ScriptTarget,
  SyntaxKind,
  type ArrowFunction,
  type CallExpression,
  type FunctionExpression,
  type MethodDeclaration,
  type ObjectLiteralExpression,
  type SourceFile,
} from "ts-morph";
import { CompilerError } from "./errors.js";
import { getOutputSchema, getParamsSchema } from "./schema.js";
import type { SidecarToolManifestEntry } from "./types.js";
import { existsSyncSafe } from "./utils.js";
import { findWidget, widgetMeta } from "./widgets.js";

/** Finds all Sidecar tool files under `server/` and returns manifest entries. */
export async function analyzeProjectTools(
  rootDir: string,
): Promise<SidecarToolManifestEntry[]> {
  const toolFiles = await findToolFiles(path.join(rootDir, "server"));
  if (toolFiles.length === 0) {
    return [];
  }

  const project = createProject(rootDir);
  return toolFiles.map((filePath) =>
    analyzeToolFile(project.addSourceFileAtPath(filePath), rootDir),
  );
}

/** Analyzes one `tool.ts` source file into a compiler manifest entry. */
export function analyzeToolFile(
  sourceFile: SourceFile,
  rootDir: string,
): SidecarToolManifestEntry {
  const definition = findToolDefinition(sourceFile);
  const name = getRequiredStringProperty(definition, "name", sourceFile);
  const id = getOptionalStringProperty(definition, "id") ?? toMachineName(name);
  const description = getRequiredStringProperty(
    definition,
    "description",
    sourceFile,
  );
  const annotations = readAnnotations(definition);
  const execute = getExecuteFunction(definition, sourceFile);

  const inputSchema = getParamsSchema(definition, execute);
  const outputSchema = getOutputSchema(definition, execute);
  const descriptor = createToolDescriptor({
    name,
    id,
    description,
    inputSchema,
    outputSchema,
    annotations,
    meta: undefined,
  });

  const absoluteFile = sourceFile.getFilePath();
  const directory = path.basename(path.dirname(absoluteFile));
  const widget = findWidget(rootDir, absoluteFile, id);
  if (widget) {
    descriptor._meta = widgetMeta(widget.resourceUri);
  }

  return {
    sourceFile: path.relative(rootDir, absoluteFile),
    directory,
    id,
    name,
    description,
    inputSchema,
    outputSchema,
    annotations,
    widget,
    descriptor,
  };
}

/** Creates a ts-morph project using the app tsconfig when available. */
function createProject(rootDir: string): Project {
  const tsconfig = path.join(rootDir, "tsconfig.json");

  return new Project({
    tsConfigFilePath: existsSyncSafe(tsconfig) ? tsconfig : undefined,
    compilerOptions: existsSyncSafe(tsconfig)
      ? undefined
      : {
          allowJs: false,
          esModuleInterop: true,
          module: ModuleKind.NodeNext,
          moduleResolution: ModuleResolutionKind.NodeNext,
          strict: true,
          target: ScriptTarget.ES2022,
        },
    skipAddingFilesFromTsConfig: true,
  });
}

/** Finds immediate server child tool files in deterministic order. */
async function findToolFiles(serverDir: string): Promise<string[]> {
  if (!existsSyncSafe(serverDir)) {
    return [];
  }

  const entries = await readdir(serverDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(serverDir, entry.name);
    if (entry.isDirectory()) {
      const candidate = path.join(entryPath, "tool.ts");
      if (existsSyncSafe(candidate)) {
        files.push(candidate);
      }
    }
  }

  return files.sort();
}

/** Locates the default-exported `tool({ ... })` object literal. */
function findToolDefinition(sourceFile: SourceFile): ObjectLiteralExpression {
  const exportAssignment = sourceFile.getExportAssignment(
    (assignment) => !assignment.isExportEquals(),
  );
  const expression = exportAssignment?.getExpression();

  if (!expression || !Node.isCallExpression(expression)) {
    throw new CompilerError(
      sourceFile,
      "tool.ts must default-export tool({ ... }).",
    );
  }

  const call = expression as CallExpression;
  const callee = call.getExpression().getText();
  if (!callee.endsWith("tool")) {
    throw new CompilerError(
      sourceFile,
      "Default export must call tool({ ... }).",
    );
  }

  const [definition] = call.getArguments();
  if (!definition || !Node.isObjectLiteralExpression(definition)) {
    throw new CompilerError(
      sourceFile,
      "tool(...) must receive one object literal.",
    );
  }

  return definition;
}

/** Reads the supported `execute` declaration shapes from a tool definition. */
function getExecuteFunction(
  definition: ObjectLiteralExpression,
  sourceFile: SourceFile,
): MethodDeclaration | ArrowFunction | FunctionExpression {
  const property = definition.getProperty("execute");
  if (!property) {
    throw new CompilerError(
      sourceFile,
      "tool({ ... }) must include an execute method.",
    );
  }

  if (Node.isMethodDeclaration(property)) {
    return property;
  }

  if (Node.isPropertyAssignment(property)) {
    const initializer = property.getInitializer();
    if (
      initializer &&
      (Node.isArrowFunction(initializer) ||
        Node.isFunctionExpression(initializer))
    ) {
      return initializer;
    }
  }

  throw new CompilerError(
    sourceFile,
    "execute must be a method, function expression, or arrow function.",
  );
}

/** Reads a required string property from the tool object. */
function getRequiredStringProperty(
  definition: ObjectLiteralExpression,
  propertyName: string,
  sourceFile: SourceFile,
): string {
  const value = getOptionalStringProperty(definition, propertyName);
  if (value === undefined || !value.trim()) {
    throw new CompilerError(
      sourceFile,
      `tool({ ... }) must include a non-empty ${propertyName} string.`,
    );
  }
  return value;
}

/** Reads an optional string literal property from the tool object. */
function getOptionalStringProperty(
  definition: ObjectLiteralExpression,
  propertyName: string,
): string | undefined {
  const property = definition.getProperty(propertyName);
  if (!property || !Node.isPropertyAssignment(property)) {
    return undefined;
  }

  const initializer = property.getInitializer();
  if (!initializer || !Node.isStringLiteral(initializer)) {
    return undefined;
  }

  return initializer.getLiteralText();
}

/** Extracts static MCP annotation hints from the tool object. */
function readAnnotations(
  definition: ObjectLiteralExpression,
): ToolAnnotations | undefined {
  const property = definition.getProperty("annotations");
  if (!property || !Node.isPropertyAssignment(property)) {
    return undefined;
  }

  const initializer = property.getInitializer();
  if (!initializer || !Node.isObjectLiteralExpression(initializer)) {
    return undefined;
  }

  const annotations: ToolAnnotations = {};
  for (const key of [
    "title",
    "readOnlyHint",
    "destructiveHint",
    "idempotentHint",
    "openWorldHint",
  ] as const) {
    const value = initializer.getProperty(key);
    if (!value || !Node.isPropertyAssignment(value)) {
      continue;
    }

    const expression = value.getInitializer();
    if (!expression) {
      continue;
    }

    if (key === "title" && Node.isStringLiteral(expression)) {
      annotations.title = expression.getLiteralText();
    } else if (
      key !== "title" &&
      (expression.getKind() === SyntaxKind.TrueKeyword ||
        expression.getKind() === SyntaxKind.FalseKeyword)
    ) {
      annotations[key] = expression.getKind() === SyntaxKind.TrueKeyword;
    }
  }

  return Object.keys(annotations).length ? annotations : undefined;
}
