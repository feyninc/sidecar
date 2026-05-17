/** Static analysis for reserved server tool files. */
import {
  createToolDescriptor,
  toMachineName,
  type ChatGptToolOptions,
  type ToolHostExtensions,
  type ToolAnnotations,
  type ToolAuthPolicy,
  type ToolVisibility,
} from "@sidecar/core";
import { readdir } from "node:fs/promises";
import path from "node:path";
import {
  Node,
  type Project,
  SyntaxKind,
  type ArrowFunction,
  type CallExpression,
  type FunctionExpression,
  type MethodDeclaration,
  type ObjectLiteralExpression,
  type SourceFile,
} from "ts-morph";
import { resolveDefaultExportCall, unwrapExpression } from "./ast.js";
import { CompilerError } from "./errors.js";
import { createProject } from "./project.js";
import { getOutputSchema, getParamsSchema } from "./schema.js";
import type { SidecarToolManifestEntry } from "./types.js";
import { existsSyncSafe } from "./utils.js";
import { findWidget, mergeWidgetMeta, readWidgetOptions, widgetMeta, widgetResourceMeta } from "./widgets.js";
import type { SidecarSourceVariant, SidecarTarget } from "./types.js";

type AuthScopeCatalog = Record<string, { id: string; description: string }>;

/** Finds all Sidecar tool files under `server/` and returns manifest entries. */
export async function analyzeProjectTools(
  rootDir: string,
  options: { target?: SidecarTarget } = {},
): Promise<SidecarToolManifestEntry[]> {
  const target = options.target ?? "mcp";
  const toolFiles = await findToolFiles(path.join(rootDir, "server"), target);
  if (toolFiles.length === 0) {
    return [];
  }

  const project = createProject(rootDir);
  const authScopes = readAuthScopeCatalog(project, rootDir);
  return toolFiles.map((candidate) =>
    analyzeToolFile(project.addSourceFileAtPath(candidate.filePath), rootDir, {
      target,
      variant: candidate.variant,
      authScopes,
    }),
  );
}

/** Analyzes one `tool.ts` source file into a compiler manifest entry. */
export function analyzeToolFile(
  sourceFile: SourceFile,
  rootDir: string,
  options: { target?: SidecarTarget; variant?: SidecarSourceVariant; authScopes?: AuthScopeCatalog } = {},
): SidecarToolManifestEntry {
  const target = options.target ?? "mcp";
  const variant = options.variant ?? "shared";
  const definition = findToolDefinition(sourceFile);
  const absoluteFile = sourceFile.getFilePath();
  const directory = path.basename(path.dirname(absoluteFile));
  const name = getRequiredStringProperty(definition, "name", sourceFile);
  const id = getOptionalStringProperty(definition, "id") ?? toMachineName(directory);
  const description = getRequiredStringProperty(
    definition,
    "description",
    sourceFile,
  );
  const annotations = readAnnotations(definition);
  const visibility = readVisibility(definition);
  const hosts = readHosts(definition);
  const auth = readAuthPolicy(definition, options.authScopes ?? {});
  const execute = getExecuteFunction(definition, sourceFile);

  const inputSchema = getParamsSchema(definition, execute);
  const outputSchema = getOutputSchema(definition, execute);
  const descriptor = createToolDescriptor({
    name,
    id,
    description,
    target,
    inputSchema,
    outputSchema,
    annotations,
    visibility,
    hosts,
    auth,
    meta: undefined,
  });

  validateWidgetHierarchy(sourceFile, absoluteFile, target, variant);

  const widget = findWidget(rootDir, absoluteFile, id, target, variant);
  if (widget) {
    const widgetFile = path.join(rootDir, widget.sourceFile);
    const project = sourceFile.getProject();
    const widgetSourceFile =
      project.getSourceFile(widgetFile) ?? project.addSourceFileAtPath(widgetFile);
    widget.options = {
      description,
      ...readWidgetOptions(widgetSourceFile),
    };
    widget.resourceMeta = widgetResourceMeta(widget.options, target);
    descriptor._meta = mergeWidgetMeta(descriptor._meta, widgetMeta(widget.resourceUri, widget.options, target));
  }

  return {
    sourceFile: path.relative(rootDir, absoluteFile),
    variant,
    target,
    directory,
    id,
    name,
    description,
    inputSchema,
    outputSchema,
    annotations,
    visibility,
    widget,
    descriptor,
  };
}

/** Extracts static auth shape for descriptor security-scheme generation. */
function readAuthPolicy(
  definition: ObjectLiteralExpression,
  authScopes: AuthScopeCatalog,
): ToolAuthPolicy | undefined {
  const initializer = readObjectProperty(definition, "auth");
  if (!initializer) {
    return undefined;
  }

  const publicValue = readBooleanProperty(initializer, "public");
  if (publicValue === true) {
    return { public: true };
  }

  const scopesProperty = initializer.getProperty("scopes");
  if (scopesProperty && Node.isPropertyAssignment(scopesProperty)) {
    return { scopes: readScopeReferences(scopesProperty.getInitializer(), authScopes) };
  }

  return { authenticated: true };
}

/** Extracts auth.ts scope declarations so generated descriptors can name required scopes. */
function readAuthScopeCatalog(project: Project, rootDir: string): AuthScopeCatalog {
  const authPath = path.join(rootDir, "auth.ts");
  if (!existsSyncSafe(authPath)) {
    return {};
  }

  const sourceFile = project.addSourceFileAtPath(authPath);
  const catalog: AuthScopeCatalog = {};
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isNamedCall(call, "auth")) {
      continue;
    }

    const definition = unwrapExpression(call.getArguments()[0]);
    if (!definition || !Node.isObjectLiteralExpression(definition)) {
      continue;
    }

    const scopes = readObjectProperty(definition, "scopes");
    if (!scopes) {
      continue;
    }

    for (const property of scopes.getProperties()) {
      if (!Node.isPropertyAssignment(property)) {
        continue;
      }

      const scope = readScopeCall(property.getInitializer());
      if (scope) {
        catalog[property.getName().replace(/^["']|["']$/g, "")] = scope;
      }
    }
  }

  return catalog;
}

/** Reads a tool auth `scopes: [...]` initializer into Sidecar scope placeholders. */
function readScopeReferences(
  initializer: Node | undefined,
  authScopes: AuthScopeCatalog,
): NonNullable<Extract<ToolAuthPolicy, { scopes: unknown }>["scopes"]> {
  const expression = unwrapExpression(initializer);
  if (!expression || !Node.isArrayLiteralExpression(expression)) {
    return [];
  }

  return expression.getElements().flatMap((element) => {
    const direct = readScopeCall(element);
    if (direct) {
      return [{ kind: "sidecar.scope" as const, ...direct }];
    }

    const name = scopeReferenceName(element);
    const declared = name ? authScopes[name] : undefined;
    if (declared) {
      return [{ kind: "sidecar.scope" as const, ...declared }];
    }

    const literal = unwrapExpression(element);
    if (literal && Node.isStringLiteral(literal)) {
      return [{
        kind: "sidecar.scope" as const,
        id: literal.getLiteralText(),
        description: "",
      }];
    }

    return [];
  });
}

/** Reads `scope("id", "description")` helper calls without executing auth.ts. */
function readScopeCall(node: Node | undefined): { id: string; description: string } | undefined {
  const expression = unwrapExpression(node);
  if (!expression || !Node.isCallExpression(expression) || !isNamedCall(expression, "scope")) {
    return undefined;
  }

  const [idArg, descriptionArg] = expression.getArguments();
  if (!idArg || !Node.isStringLiteral(idArg)) {
    return undefined;
  }

  return {
    id: idArg.getLiteralText(),
    description: Node.isStringLiteral(descriptionArg) ? descriptionArg.getLiteralText() : "",
  };
}

/** Returns the final property name from references like `scopes.expensesRead`. */
function scopeReferenceName(node: Node): string | undefined {
  const expression = unwrapExpression(node);
  if (!expression || !Node.isPropertyAccessExpression(expression)) {
    return undefined;
  }

  return expression.getName();
}

/** Returns true for direct or namespace-qualified helper calls. */
function isNamedCall(call: CallExpression, name: string): boolean {
  const callee = call.getExpression().getText();
  return callee === name || callee.endsWith(`.${name}`);
}

/** Enforces Sidecar's hierarchical reserved-file platform rule. */
function validateWidgetHierarchy(
  sourceFile: SourceFile,
  toolFile: string,
  target: SidecarTarget,
  variant: SidecarSourceVariant,
): void {
  const directory = path.dirname(toolFile);
  const platformWidget =
    target === "chatgpt"
      ? "widget.openai.tsx"
      : target === "claude"
        ? "widget.anthropic.tsx"
        : undefined;

  if (!platformWidget || variant !== "shared") {
    return;
  }

  if (existsSyncSafe(path.join(directory, platformWidget))) {
    const expectedTool =
      target === "chatgpt" ? "tool.openai.ts" : "tool.anthropic.ts";
    throw new CompilerError(
      sourceFile,
      `${platformWidget} requires a sibling ${expectedTool}; platform-specific widgets cannot attach to a shared tool.ts.`,
    );
  }
}

/** Finds immediate server child tool files in deterministic order. */
type ToolFileCandidate = {
  filePath: string;
  variant: SidecarSourceVariant;
};

async function findToolFiles(serverDir: string, target: SidecarTarget): Promise<ToolFileCandidate[]> {
  if (!existsSyncSafe(serverDir)) {
    return [];
  }

  const entries = await readdir(serverDir, { withFileTypes: true });
  const files: ToolFileCandidate[] = [];

  for (const entry of entries) {
    const entryPath = path.join(serverDir, entry.name);
    if (entry.isDirectory()) {
      const candidate = selectToolFile(entryPath, target);
      if (candidate) {
        files.push(candidate);
      }
    }
  }

  return files.sort((left, right) => left.filePath.localeCompare(right.filePath));
}

/** Picks the platform-specific tool file for a target, falling back to shared code. */
function selectToolFile(directory: string, target: SidecarTarget): ToolFileCandidate | undefined {
  const candidates =
    target === "chatgpt"
      ? [
          { name: "tool.openai.ts", variant: "openai" as const },
          { name: "tool.ts", variant: "shared" as const },
        ]
      : target === "claude"
        ? [
            { name: "tool.anthropic.ts", variant: "anthropic" as const },
            { name: "tool.ts", variant: "shared" as const },
          ]
        : [{ name: "tool.ts", variant: "shared" as const }];

  for (const candidate of candidates) {
    const filePath = path.join(directory, candidate.name);
    if (existsSyncSafe(filePath)) {
      return { filePath, variant: candidate.variant };
    }
  }

  return undefined;
}

/** Locates the default-exported `tool({ ... })` object literal. */
function findToolDefinition(sourceFile: SourceFile): ObjectLiteralExpression {
  const call = resolveDefaultExportCall(sourceFile, "tool");
  if (!call) {
    throw new CompilerError(
      sourceFile,
      "tool.ts must default-export tool({ ... }) or an identifier initialized with tool({ ... }).",
    );
  }

  const definition = unwrapExpression(call.getArguments()[0]);
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

/** Drops undefined properties from small parsed option objects. */
function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}
