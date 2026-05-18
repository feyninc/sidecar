/** TypeScript and lightweight Zod-to-JSON-Schema extraction. */
import { emptyObjectSchema, type JsonSchema } from "@sidecar-ai/core";
import {
  Node,
  type ArrowFunction,
  type FunctionExpression,
  type MethodDeclaration,
  type ObjectLiteralExpression,
  type PropertyAssignment,
  type Symbol as MorphSymbol,
  type Type,
} from "ts-morph";

/** Supported AST nodes that can execute a Sidecar tool. */
export type ExecutableNode = MethodDeclaration | ArrowFunction | FunctionExpression;

/** Builds the input schema from explicit params or the execute param type. */
export function getParamsSchema(
  definition: ObjectLiteralExpression,
  execute: ExecutableNode,
): JsonSchema {
  const explicitParams = definition.getProperty("params");
  if (explicitParams && Node.isPropertyAssignment(explicitParams)) {
    const inferred = getSchemaFromZodProperty(explicitParams);
    if (inferred) {
      return inferred;
    }
  }

  const [params] = execute.getParameters();
  if (!params) {
    return emptyObjectSchema();
  }

  return typeToJsonSchema(
    params.getType(),
    schemaDescription(params.getSymbol()),
  );
}

/** Builds the output schema from explicit output or the execute return type. */
export function getOutputSchema(
  definition: ObjectLiteralExpression,
  execute: ExecutableNode,
): JsonSchema | undefined {
  const explicitOutput = definition.getProperty("output");
  if (explicitOutput && Node.isPropertyAssignment(explicitOutput)) {
    return undefined;
  }

  const returnType = unwrapToolResultType(unwrapPromiseType(execute.getReturnType()));
  if (returnType.isVoid() || returnType.isUndefined()) {
    return undefined;
  }

  return typeToJsonSchema(returnType);
}

/** Extracts a small JSON Schema subset from `params: z.object(...)`. */
function getSchemaFromZodProperty(
  property: PropertyAssignment,
): JsonSchema | undefined {
  const initializer = property.getInitializer();
  if (!initializer) {
    return undefined;
  }

  if (
    Node.isCallExpression(initializer) &&
    initializer.getExpression().getText().endsWith(".object")
  ) {
    const [shape] = initializer.getArguments();
    if (shape && Node.isObjectLiteralExpression(shape)) {
      return zodObjectLiteralToSchema(shape);
    }
  }

  return undefined;
}

/** Converts a Zod object literal shape into JSON Schema. */
function zodObjectLiteralToSchema(shape: ObjectLiteralExpression): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const property of shape.getProperties()) {
    if (!Node.isPropertyAssignment(property)) {
      continue;
    }

    const name = property.getName().replace(/^["']|["']$/g, "");
    const initializer = property.getInitializer();
    if (!initializer) {
      continue;
    }

    const propertySchema = zodExpressionToSchema(initializer);
    properties[name] = propertySchema.schema;
    if (!propertySchema.optional) {
      required.push(name);
    }
  }

  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

/** Converts a supported Zod expression into a property schema. */
function zodExpressionToSchema(expression: Node): {
  schema: JsonSchema;
  optional: boolean;
} {
  const text = expression.getText();
  const optional = /\.optional\(\)/.test(text) || /\.default\(/.test(text);
  const schema: JsonSchema = {};

  if (/z\.string\(\)/.test(text)) {
    schema.type = "string";
  } else if (/z\.number\(\)/.test(text)) {
    schema.type = "number";
  } else if (/z\.boolean\(\)/.test(text)) {
    schema.type = "boolean";
  } else if (/z\.array\(/.test(text)) {
    schema.type = "array";
    schema.items = {};
  } else {
    schema.type = "object";
  }

  const min = text.match(/\.min\((\d+)/);
  const max = text.match(/\.max\((\d+)/);
  if (schema.type === "string") {
    if (min) schema.minLength = Number(min[1]);
    if (max) schema.maxLength = Number(max[1]);
  } else {
    if (min) schema.minimum = Number(min[1]);
    if (max) schema.maximum = Number(max[1]);
  }

  if (/\.int\(\)/.test(text)) {
    schema.type = "integer";
  }

  return { schema, optional };
}

/** Converts a TypeScript type into a JSON Schema object. */
function typeToJsonSchema(type: Type, description?: string): JsonSchema {
  const withoutUndefined = removeUndefined(type);
  const schema = typeToJsonSchemaInner(withoutUndefined);
  if (description) {
    schema.description = description;
  }
  return schema;
}

/** Recursively maps TypeScript primitives, unions, arrays, tuples, and objects. */
function typeToJsonSchemaInner(type: Type): JsonSchema {
  if (type.isString() || type.isStringLiteral()) {
    return literalOrPrimitive(type, "string");
  }
  if (type.isNumber() || type.isNumberLiteral()) {
    return literalOrPrimitive(type, "number");
  }
  if (type.isBoolean() || type.isBooleanLiteral()) {
    return literalOrPrimitive(type, "boolean");
  }
  if (type.isNull()) {
    return { type: "null" };
  }
  if (type.isArray()) {
    return {
      type: "array",
      items: typeToJsonSchema(type.getArrayElementTypeOrThrow()),
    };
  }
  if (type.isTuple()) {
    const elements = type.getTupleElements();
    return {
      type: "array",
      items:
        elements.length === 1
          ? typeToJsonSchema(elements[0]!)
          : { anyOf: elements.map((item) => typeToJsonSchema(item)) },
    };
  }
  if (type.isUnion()) {
    const parts = type.getUnionTypes().filter((part) => !part.isUndefined());
    if (parts.every(isLiteralType)) {
      return { enum: parts.map((part) => literalValue(part)) };
    }
    return { anyOf: parts.map((part) => typeToJsonSchema(part)) };
  }

  const properties = type.getProperties();
  const indexType = type.getStringIndexType() ?? type.getNumberIndexType();
  if (properties.length > 0) {
    return objectTypeToSchema(properties, indexType);
  }

  if (indexType) {
    return {
      type: "object",
      additionalProperties: indexTypeToAdditionalProperties(indexType),
    };
  }

  return {};
}

/** Converts object properties into JSON Schema properties and required lists. */
function objectTypeToSchema(
  properties: MorphSymbol[],
  indexType: Type | undefined,
): JsonSchema {
  const schemaProperties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const property of properties) {
    const declaration =
      property.getValueDeclaration() ?? property.getDeclarations()[0];
    if (!declaration) {
      continue;
    }

    const name = property.getName();
    const rawType = property.getTypeAtLocation(declaration);
    const propertyType = removeUndefined(rawType);
    const propertySchema = typeToJsonSchema(
      propertyType,
      schemaDescription(property),
    );
    schemaProperties[name] = propertySchema;

    if (!property.isOptional() && !containsUndefined(rawType)) {
      required.push(name);
    }
  }

  return {
    type: "object",
    properties: schemaProperties,
    required,
    additionalProperties: indexType
      ? indexTypeToAdditionalProperties(indexType)
      : false,
  };
}

/** Converts a TypeScript index signature into JSON Schema additionalProperties. */
function indexTypeToAdditionalProperties(type: Type): boolean | JsonSchema {
  if (type.isAny() || type.isUnknown()) {
    return true;
  }

  const schema = typeToJsonSchema(type);
  return Object.keys(schema).length ? schema : true;
}

/** Returns a literal const schema when possible, otherwise a primitive schema. */
function literalOrPrimitive(
  type: Type,
  primitive: "string" | "number" | "boolean",
): JsonSchema {
  if (isLiteralType(type)) {
    return { const: literalValue(type) };
  }
  return { type: primitive };
}

/** Returns true for literal string, number, and boolean types. */
function isLiteralType(type: Type): boolean {
  return (
    type.isStringLiteral() || type.isNumberLiteral() || type.isBooleanLiteral()
  );
}

/** Reads a JavaScript literal value from a TypeScript literal type. */
function literalValue(type: Type): string | number | boolean {
  if (type.isStringLiteral()) return String(type.getLiteralValue());
  if (type.isNumberLiteral()) return Number(type.getLiteralValue());
  const text = type.getText();
  return text === "true";
}

/** Unwraps `Promise<T>` return types for output schema inference. */
function unwrapPromiseType(type: Type): Type {
  if (!type.getText().startsWith("Promise<")) {
    return type;
  }
  const args = type.getTypeArguments();
  return args[0] ?? type;
}

/** Extracts the structured content type from Sidecar's required `ToolResult<T>`. */
function unwrapToolResultType(type: Type): Type {
  const aliasName = type.getAliasSymbol()?.getName();
  if (aliasName === "ToolResult") {
    const [structured] = type.getAliasTypeArguments();
    return structured ?? type;
  }

  const structured = type.getProperty("structuredContent");
  const declaration = structured?.getValueDeclaration() ?? structured?.getDeclarations()[0];
  if (!structured || !declaration) {
    return type;
  }

  return removeUndefined(structured.getTypeAtLocation(declaration));
}

/** Removes `undefined` from simple union types. */
function removeUndefined(type: Type): Type {
  if (!type.isUnion()) {
    return type;
  }

  const nonUndefined = type
    .getUnionTypes()
    .filter((part) => !part.isUndefined());
  return nonUndefined.length === 1 ? nonUndefined[0]! : type;
}

/** Returns true when a union includes `undefined`. */
function containsUndefined(type: Type): boolean {
  return (
    type.isUnion() && type.getUnionTypes().some((part) => part.isUndefined())
  );
}

/** Reads the first JSDoc description attached to a symbol. */
function schemaDescription(
  symbol: MorphSymbol | undefined,
): string | undefined {
  if (!symbol) {
    return undefined;
  }

  return symbol
    .getDeclarations()
    .flatMap((declaration) => {
      if (Node.isJSDocable(declaration)) {
        return declaration.getJsDocs().map((doc) => doc.getCommentText() ?? "");
      }
      return [];
    })
    .find((comment) => comment.trim().length > 0);
}
