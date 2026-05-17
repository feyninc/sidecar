/** Claude hook generation from typed reserved hook files. */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  Node,
  Project,
  SyntaxKind,
  type ArrayLiteralExpression,
  type CallExpression,
  type Expression,
  type ObjectLiteralExpression,
} from "ts-morph";
import { resolveDefaultExportCall, unwrapExpression } from "../ast.js";
import { existsSyncSafe, stripUndefined } from "../utils.js";

type HookHandler = Record<string, unknown> & {
  type: "command" | "http";
};

type HookMatcher = {
  matcher?: string;
  hooks: HookHandler[];
};

type HookConfig = Record<string, HookMatcher[]>;

/** Emits one merged `hooks.json` from reserved hook directories. */
export async function copyHooks(
  rootDir: string,
  destination: string,
): Promise<void> {
  const source = path.join(rootDir, "hooks");
  if (!existsSyncSafe(source)) {
    return;
  }

  const entries = await readdir(source, { withFileTypes: true });
  const hookDirs = entries.filter(
    (entry) => entry.isDirectory() && existsSyncSafe(path.join(source, entry.name, "hook.ts")),
  );
  if (!hookDirs.length) {
    return;
  }

  const config: HookConfig = {};
  for (const entry of hookDirs) {
    const filePath = path.join(source, entry.name, "hook.ts");
    mergeHooks(config, parseHookFile(await readFile(filePath, "utf8"), entry.name));
  }

  await mkdir(destination, { recursive: true });
  await writeFile(
    path.join(destination, "hooks.json"),
    `${JSON.stringify(config, null, 2)}\n`,
  );
}

/** Parses a single reserved hook file into Claude hook JSON fragments. */
function parseHookFile(source: string, fallbackName: string): HookConfig {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile(`${fallbackName}.ts`, source);
  const call =
    resolveDefaultExportCall(sourceFile, "hook") ??
    resolveDefaultExportCall(sourceFile, "hooks");
  if (!call) {
    throw new Error(`hooks/${fallbackName}/hook.ts must default-export hook({ ... }) or hooks({ ... }).`);
  }

  const definition = unwrapExpression(call.getArguments()[0]);
  if (!definition || !Node.isObjectLiteralExpression(definition)) {
    throw new Error(`hooks/${fallbackName}/hook.ts must default-export hook({ ... }) or hooks({ ... }).`);
  }

  const callee = call.getExpression().getText();
  if (callee === "hook" || callee.endsWith(".hook")) {
    const entry = parseHookDefinition(definition, fallbackName);
    return { [entry.event]: [stripUndefined({ matcher: entry.matcher, hooks: entry.run })] };
  }

  if (callee === "hooks" || callee.endsWith(".hooks")) {
    return parseHooksDefinition(definition, fallbackName);
  }

  throw new Error(`hooks/${fallbackName}/hook.ts must default-export hook({ ... }) or hooks({ ... }).`);
}

/** Parses `hook({ event, matcher, hooks })`. */
function parseHookDefinition(
  definition: ObjectLiteralExpression,
  fallbackName: string,
): { event: string; matcher?: string; run: HookHandler[] } {
  const event = readStringProperty(definition, "event");
  if (!event) {
    throw new Error(`hooks/${fallbackName}/hook.ts must declare an event string.`);
  }

  const hooks = readHookArray(definition, "run", fallbackName);
  if (!hooks.length) {
    throw new Error(`hooks/${fallbackName}/hook.ts must declare at least one run handler.`);
  }

  return {
    event,
    matcher: readStringProperty(definition, "matcher"),
    run: hooks,
  };
}

/** Parses `hooks({ EventName: [{ matcher, run: [...] }] })`. */
function parseHooksDefinition(
  definition: ObjectLiteralExpression,
  fallbackName: string,
): HookConfig {
  const config: HookConfig = {};

  for (const property of definition.getProperties()) {
    if (!Node.isPropertyAssignment(property)) {
      continue;
    }

    const event = property.getName().replace(/^["']|["']$/g, "");
    const initializer = property.getInitializer();
    if (!initializer || !Node.isArrayLiteralExpression(initializer)) {
      throw new Error(`hooks/${fallbackName}/hook.ts event "${event}" must be an array.`);
    }

    config[event] = initializer.getElements().map((entry) => {
      if (!Node.isObjectLiteralExpression(entry)) {
        throw new Error(`hooks/${fallbackName}/hook.ts event "${event}" entries must be objects.`);
      }

      return stripUndefined({
        matcher: readStringProperty(entry, "matcher"),
        hooks: readHookArray(entry, "run", fallbackName),
      });
    });
  }

  return config;
}

/** Reads a hook handler array from an object literal property. */
function readHookArray(
  definition: ObjectLiteralExpression,
  propertyName: string,
  fallbackName: string,
): HookHandler[] {
  const property = definition.getProperty(propertyName);
  if (!property || !Node.isPropertyAssignment(property)) {
    return [];
  }

  const initializer = property.getInitializer();
  if (!initializer || !Node.isArrayLiteralExpression(initializer)) {
    throw new Error(`hooks/${fallbackName}/hook.ts ${propertyName} must be an array.`);
  }

  return parseHookHandlers(initializer, fallbackName);
}

/** Parses hook handlers written as object literals or helper calls. */
function parseHookHandlers(
  handlers: ArrayLiteralExpression,
  fallbackName: string,
): HookHandler[] {
  return handlers.getElements().map((handler) => parseHookHandler(handler, fallbackName));
}

/** Parses one command/http hook handler. */
function parseHookHandler(
  handler: Expression,
  fallbackName: string,
): HookHandler {
  if (Node.isObjectLiteralExpression(handler)) {
    const type = readStringProperty(handler, "type");
    if (type !== "command" && type !== "http") {
      throw new Error(`hooks/${fallbackName}/hook.ts hook handlers need type "command" or "http".`);
    }
    return objectLiteralToRecord(handler) as HookHandler;
  }

  if (Node.isCallExpression(handler)) {
    return parseHookHandlerCall(handler, fallbackName);
  }

  throw new Error(`hooks/${fallbackName}/hook.ts hook handlers must be objects or helper calls.`);
}

/** Parses `commandHook(...)` and `httpHook(...)` helper calls. */
function parseHookHandlerCall(
  handler: CallExpression,
  fallbackName: string,
): HookHandler {
  const callee = handler.getExpression().getText();
  const [firstArg, optionsArg] = handler.getArguments();
  const first = firstArg ? stringFromExpression(firstArg) : undefined;
  if (!first) {
    throw new Error(`hooks/${fallbackName}/hook.ts hook helper calls require a string first argument.`);
  }

  const options =
    optionsArg && Node.isObjectLiteralExpression(optionsArg)
      ? objectLiteralToRecord(optionsArg)
      : {};

  if (callee.endsWith("commandHook")) {
    return stripUndefined({
      type: "command",
      command: first,
      ...options,
    }) as HookHandler;
  }

  if (callee.endsWith("httpHook")) {
    return stripUndefined({
      type: "http",
      url: first,
      ...options,
    }) as HookHandler;
  }

  throw new Error(`hooks/${fallbackName}/hook.ts uses an unsupported hook helper "${callee}".`);
}

/** Converts a simple object literal into JSON-compatible data. */
function objectLiteralToRecord(object: ObjectLiteralExpression): Record<string, unknown> {
  const record: Record<string, unknown> = {};

  for (const property of object.getProperties()) {
    if (!Node.isPropertyAssignment(property)) {
      continue;
    }

    const key = property.getName().replace(/^["']|["']$/g, "");
    const initializer = property.getInitializer();
    if (!initializer) {
      continue;
    }
    record[key] = valueFromExpression(initializer);
  }

  return stripUndefined(record);
}

/** Reads a simple string property from an object literal. */
function readStringProperty(
  object: ObjectLiteralExpression,
  propertyName: string,
): string | undefined {
  const property = object.getProperty(propertyName);
  if (!property || !Node.isPropertyAssignment(property)) {
    return undefined;
  }

  const initializer = property.getInitializer();
  return initializer ? stringFromExpression(initializer) : undefined;
}

/** Converts supported literal expressions into JSON-compatible values. */
function valueFromExpression(expression: Expression): unknown {
  const string = stringFromExpression(expression);
  if (string !== undefined) {
    return string;
  }

  if (expression.getKind() ===  SyntaxKind.TrueKeyword) {
    return true;
  }
  if (expression.getKind() ===  SyntaxKind.FalseKeyword) {
    return false;
  }
  if (Node.isNumericLiteral(expression)) {
    return Number(expression.getLiteralText());
  }
  if (Node.isArrayLiteralExpression(expression)) {
    return expression.getElements().map(valueFromExpression);
  }
  if (Node.isObjectLiteralExpression(expression)) {
    return objectLiteralToRecord(expression);
  }

  return undefined;
}

/** Reads string literals and no-substitution template literals. */
function stringFromExpression(expression: Node): string | undefined {
  if (Node.isStringLiteral(expression) || Node.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.getLiteralText();
  }
  return undefined;
}

/** Merges parsed hook config fragments preserving event order. */
function mergeHooks(target: HookConfig, source: HookConfig): void {
  for (const [event, matchers] of Object.entries(source)) {
    target[event] = [...(target[event] ?? []), ...matchers];
  }
}
