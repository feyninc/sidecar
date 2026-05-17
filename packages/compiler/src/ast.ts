/** Shared ts-morph helpers for reserved Sidecar files. */
import {
  Node,
  type CallExpression,
  type SourceFile,
  type VariableDeclaration,
} from "ts-morph";

/**
 * Resolves a default export into a call to the requested authoring helper.
 *
 * This supports both idiomatic shapes:
 *
 * - `export default tool({ ... })`
 * - `const review = tool({ ... }); export default review`
 */
export function resolveDefaultExportCall(
  sourceFile: SourceFile,
  helperName: string,
): CallExpression | undefined {
  const exportAssignment = sourceFile.getExportAssignment(
    (assignment) => !assignment.isExportEquals(),
  );
  const expression = unwrapExpression(exportAssignment?.getExpression());
  const direct = asHelperCall(expression, helperName);
  if (direct) {
    return direct;
  }

  if (!expression || !Node.isIdentifier(expression)) {
    return undefined;
  }

  const declaration = findVariableDeclaration(sourceFile, expression.getText());
  const initializer = unwrapExpression(declaration?.getInitializer());
  return asHelperCall(initializer, helperName);
}

/** Removes TypeScript-only wrappers such as `satisfies` from expressions. */
export function unwrapExpression(expression: Node | undefined): Node | undefined {
  if (!expression) {
    return undefined;
  }

  if (Node.isSatisfiesExpression(expression) || Node.isAsExpression(expression)) {
    return expression.getExpression();
  }

  return expression;
}

/** Returns a helper call when the expression calls exactly that helper. */
function asHelperCall(
  expression: Node | undefined,
  helperName: string,
): CallExpression | undefined {
  if (!expression || !Node.isCallExpression(expression)) {
    return undefined;
  }

  const callee = expression.getExpression().getText();
  return matchesHelperName(callee, helperName) ? expression : undefined;
}

/** Finds a top-level variable declaration by identifier name. */
function findVariableDeclaration(
  sourceFile: SourceFile,
  name: string,
): VariableDeclaration | undefined {
  return sourceFile
    .getVariableDeclarations()
    .find((declaration) => declaration.getName() === name);
}

/** Checks imported, namespaced, and locally scoped helper call names. */
function matchesHelperName(callee: string, helperName: string): boolean {
  return callee === helperName || callee.endsWith(`.${helperName}`);
}
