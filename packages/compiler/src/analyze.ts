/** Static analysis for reserved server tool files. */
import {
  createToolDescriptor,
  toMachineName,
  type ChatGptToolOptions,
  type ChatGptWidgetOptions,
  type ToolHostExtensions,
  type ToolAnnotations,
  type ToolVisibility,
  type ToolWidgetOptions,
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
import { findWidget, mergeWidgetMeta, widgetMeta } from "./widgets.js";

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
  const visibility = readVisibility(definition);
  const hosts = readHosts(definition);
  const widgetOptions = readWidgetOptions(definition);
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
    visibility,
    hosts,
    meta: undefined,
  });

  const absoluteFile = sourceFile.getFilePath();
  const directory = path.basename(path.dirname(absoluteFile));
  const widget = findWidget(rootDir, absoluteFile, id, widgetOptions);
  if (widget) {
    descriptor._meta = mergeWidgetMeta(descriptor._meta, widgetMeta(widget.resourceUri, widget.options));
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

/** Extracts static Sidecar visibility policy from the tool object. */
function readVisibility(
  definition: ObjectLiteralExpression,
): ToolVisibility | undefined {
  const initializer = readObjectProperty(definition, "visibility");
  if (!initializer) {
    return undefined;
  }

  const visibility: ToolVisibility = {};
  for (const key of ["model", "widgets", "tools"] as const) {
    const property = initializer.getProperty(key);
    if (!property || !Node.isPropertyAssignment(property)) {
      continue;
    }

    const value = property.getInitializer();
    if (!value) {
      continue;
    }

    if (
      value.getKind() === SyntaxKind.TrueKeyword ||
      value.getKind() === SyntaxKind.FalseKeyword
    ) {
      assignVisibility(visibility, key, value.getKind() === SyntaxKind.TrueKeyword);
    } else if (Node.isArrayLiteralExpression(value)) {
      assignVisibility(visibility, key, value
        .getElements()
        .filter(Node.isStringLiteral)
        .map((element) => element.getLiteralText()));
    }
  }

  return Object.keys(visibility).length ? visibility : undefined;
}

/** Assigns a visibility property without losing the precise key type. */
function assignVisibility<Key extends keyof ToolVisibility>(
  visibility: ToolVisibility,
  key: Key,
  value: ToolVisibility[Key],
): void {
  visibility[key] = value;
}

/** Extracts supported host-specific extension metadata from the tool object. */
function readHosts(
  definition: ObjectLiteralExpression,
): ToolHostExtensions | undefined {
  const initializer = readObjectProperty(definition, "hosts");
  if (!initializer) {
    return undefined;
  }

  const chatgpt = readObjectProperty(initializer, "chatgpt");
  if (!chatgpt) {
    return undefined;
  }

  const options: ChatGptToolOptions = {};
  const invoking = readStringProperty(chatgpt, "invoking");
  const invoked = readStringProperty(chatgpt, "invoked");
  const visibility = readStringProperty(chatgpt, "visibility");
  const widgetAccessible = readBooleanProperty(chatgpt, "widgetAccessible");
  const fileParams = readStringArrayProperty(chatgpt, "fileParams");

  if (invoking) options.invoking = invoking;
  if (invoked) options.invoked = invoked;
  if (visibility === "public" || visibility === "private") {
    options.visibility = visibility;
  }
  if (widgetAccessible !== undefined) {
    options.widgetAccessible = widgetAccessible;
  }
  if (fileParams) {
    options.fileParams = fileParams;
  }

  return Object.keys(options).length ? { chatgpt: options } : undefined;
}

/** Extracts widget resource metadata from the tool object. */
function readWidgetOptions(
  definition: ObjectLiteralExpression,
): ToolWidgetOptions | undefined {
  const initializer = readObjectProperty(definition, "widget");
  if (!initializer) {
    return undefined;
  }

  const options: ToolWidgetOptions = {};
  const description = readStringProperty(initializer, "description");
  const prefersBorder = readBooleanProperty(initializer, "prefersBorder");
  const csp = readWidgetCsp(initializer);
  const chatgpt = readChatGptWidgetOptions(initializer);

  if (description) options.description = description;
  if (prefersBorder !== undefined) options.prefersBorder = prefersBorder;
  if (csp) options.csp = csp;
  if (chatgpt) options.hosts = { chatgpt };

  return Object.keys(options).length ? options : undefined;
}

/** Reads standard widget CSP options. */
function readWidgetCsp(
  definition: ObjectLiteralExpression,
): ToolWidgetOptions["csp"] | undefined {
  const initializer = readObjectProperty(definition, "csp");
  if (!initializer) {
    return undefined;
  }

  const csp = {
    connectDomains: readStringArrayProperty(initializer, "connectDomains"),
    resourceDomains: readStringArrayProperty(initializer, "resourceDomains"),
    frameDomains: readStringArrayProperty(initializer, "frameDomains"),
  };
  return stripUndefined(csp);
}

/** Reads ChatGPT-only widget compatibility options. */
function readChatGptWidgetOptions(
  definition: ObjectLiteralExpression,
): ChatGptWidgetOptions | undefined {
  const hosts = readObjectProperty(definition, "hosts");
  const chatgpt = hosts ? readObjectProperty(hosts, "chatgpt") : undefined;
  if (!chatgpt) {
    return undefined;
  }

  const options = {
    domain: readStringProperty(chatgpt, "domain"),
    redirectDomains: readStringArrayProperty(chatgpt, "redirectDomains"),
  };
  return stripUndefined(options);
}

/** Reads a nested object literal property, unwrapping `satisfies` expressions. */
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

/** Reads a string literal property from an object literal. */
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

/** Reads a boolean literal property from an object literal. */
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

  if (initializer.getKind() === SyntaxKind.TrueKeyword) {
    return true;
  }
  if (initializer.getKind() === SyntaxKind.FalseKeyword) {
    return false;
  }
  return undefined;
}

/** Reads a string literal array property from an object literal. */
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

/** Removes TypeScript-only wrappers such as `satisfies` from initializers. */
function unwrapExpression(expression: Node | undefined): Node | undefined {
  if (!expression) {
    return undefined;
  }

  if (Node.isSatisfiesExpression(expression) || Node.isAsExpression(expression)) {
    return expression.getExpression();
  }

  return expression;
}

/** Drops undefined properties from small parsed option objects. */
function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}
