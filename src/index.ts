import type { PluginFunction, PluginValidateFn } from "@graphql-codegen/plugin-helpers";
import {
  Kind,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
  isUnionType,
  type ConstValueNode,
  type GraphQLEnumType,
  type GraphQLInputField,
  type GraphQLInputObjectType,
  type GraphQLNamedType,
  type GraphQLObjectType,
  type GraphQLSchema,
  type GraphQLType,
} from "graphql";

export interface SimpleZodPluginConfig {
  schemaNamePrefix?: string;
  schemaNameSuffix?: string;
  includeTypename?: boolean;
  includeClientMutationId?: boolean;
  includeRelations?: boolean;
  includeConnectionAndEdgeTypes?: boolean;
  useTypeScriptEnums?: boolean;
  nullableWithDefaultNull?: boolean;
  scalarSchemas?: Record<string, string>;
}

interface NormalizedConfig {
  schemaNamePrefix: string;
  schemaNameSuffix: string;
  includeTypename: boolean;
  includeClientMutationId: boolean;
  includeRelations: boolean;
  includeConnectionAndEdgeTypes: boolean;
  useTypeScriptEnums: boolean;
  nullableWithDefaultNull: boolean;
  scalarSchemas: Record<string, string>;
}

const DEFAULT_SCALAR_SCHEMAS: Readonly<Record<string, string>> = {
  Boolean: "z.boolean()",
  Float: "z.number()",
  ID: "z.string()",
  Int: "z.number().int()",
  String: "z.string()",
};

const RESERVED_IDENTIFIERS = new Set([
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function normalizeConfig(config: SimpleZodPluginConfig | null | undefined): NormalizedConfig {
  return {
    schemaNamePrefix: config?.schemaNamePrefix ?? "",
    schemaNameSuffix: config?.schemaNameSuffix ?? "Schema",
    includeTypename: config?.includeTypename ?? false,
    includeClientMutationId: config?.includeClientMutationId ?? false,
    includeRelations: config?.includeRelations ?? false,
    includeConnectionAndEdgeTypes: config?.includeConnectionAndEdgeTypes ?? false,
    useTypeScriptEnums: config?.useTypeScriptEnums ?? false,
    nullableWithDefaultNull: config?.nullableWithDefaultNull ?? false,
    scalarSchemas: config?.scalarSchemas ?? {},
  };
}

function generatedTypes(schema: GraphQLSchema, config: NormalizedConfig): GraphQLNamedType[] {
  const operationTypes = new Set<GraphQLNamedType>();
  for (const type of [
    schema.getQueryType(),
    schema.getMutationType(),
    schema.getSubscriptionType(),
  ]) {
    if (type != null) operationTypes.add(type);
  }

  return Object.values(schema.getTypeMap())
    .filter((type) => !type.name.startsWith("__"))
    .filter((type) => !operationTypes.has(type))
    .filter((type) => isEnumType(type) || isInputObjectType(type) || isObjectType(type))
    .filter(
      (type) =>
        config.includeConnectionAndEdgeTypes ||
        !isObjectType(type) ||
        (!type.name.endsWith("Connection") && !type.name.endsWith("Edge")),
    )
    .sort((left, right) => {
      const kindOrder = typeOrder(left) - typeOrder(right);
      return kindOrder || left.name.localeCompare(right.name);
    });
}

function typeOrder(type: GraphQLNamedType): number {
  if (isEnumType(type)) return 0;
  if (isInputObjectType(type)) return 1;
  return 2;
}

function schemaName(typeName: string, config: NormalizedConfig): string {
  return `${config.schemaNamePrefix}${typeName}${config.schemaNameSuffix}`;
}

function assertConfig(
  schema: GraphQLSchema,
  rawConfig: SimpleZodPluginConfig | null | undefined,
): NormalizedConfig {
  if (rawConfig !== undefined && rawConfig !== null && !isPlainObject(rawConfig)) {
    throw new Error("Simple Zod plugin configuration must be an object.");
  }

  assertOptionalType(rawConfig, "schemaNamePrefix", "string");
  assertOptionalType(rawConfig, "schemaNameSuffix", "string");
  assertOptionalType(rawConfig, "includeTypename", "boolean");
  assertOptionalType(rawConfig, "includeClientMutationId", "boolean");
  assertOptionalType(rawConfig, "includeRelations", "boolean");
  assertOptionalType(rawConfig, "includeConnectionAndEdgeTypes", "boolean");
  assertOptionalType(rawConfig, "useTypeScriptEnums", "boolean");
  assertOptionalType(rawConfig, "nullableWithDefaultNull", "boolean");

  if (rawConfig?.scalarSchemas !== undefined && !isPlainObject(rawConfig.scalarSchemas)) {
    throw new Error('"scalarSchemas" must be an object of Zod expressions.');
  }

  for (const [scalar, expression] of Object.entries(rawConfig?.scalarSchemas ?? {})) {
    if (typeof expression !== "string" || expression.trim() === "") {
      throw new Error(
        `"scalarSchemas.${scalar}" must be a non-empty string containing a Zod expression.`,
      );
    }
  }

  const config = normalizeConfig(rawConfig);
  const usedNames = new Map<string, string>();
  const runtimeEnumNames = new Set(
    config.useTypeScriptEnums
      ? generatedTypes(schema, config)
          .filter(isEnumType)
          .map((type) => type.name)
      : [],
  );

  for (const type of generatedTypes(schema, config)) {
    const name = schemaName(type.name, config);
    if (!IDENTIFIER_PATTERN.test(name) || RESERVED_IDENTIFIERS.has(name)) {
      throw new Error(
        `Generated schema name "${name}" for GraphQL type "${type.name}" is not a valid TypeScript identifier.`,
      );
    }
    if (name === "z") {
      throw new Error(
        `Generated schema name "z" for GraphQL type "${type.name}" conflicts with the Zod import.`,
      );
    }
    if (runtimeEnumNames.has(name)) {
      throw new Error(
        `Generated schema name "${name}" for GraphQL type "${type.name}" conflicts with the runtime TypeScript enum of the same name.`,
      );
    }

    const existingType = usedNames.get(name);
    if (existingType !== undefined) {
      throw new Error(
        `GraphQL types "${existingType}" and "${type.name}" both generate the schema name "${name}".`,
      );
    }
    usedNames.set(name, type.name);
  }

  return config;
}

function assertOptionalType(
  config: SimpleZodPluginConfig | null | undefined,
  key: keyof SimpleZodPluginConfig,
  expected: "boolean" | "string",
): void {
  const value = config?.[key];
  if (value !== undefined && typeof value !== expected) {
    throw new Error(`"${key}" must be a ${expected}.`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function renderNamedType(
  type: GraphQLNamedType,
  names: ReadonlyMap<string, string>,
  config: NormalizedConfig,
): string {
  if (isScalarType(type)) {
    return config.scalarSchemas[type.name] ?? DEFAULT_SCALAR_SCHEMAS[type.name] ?? "z.unknown()";
  }

  if (isInterfaceType(type) || isUnionType(type)) return "z.unknown()";
  return names.get(type.name) ?? "z.unknown()";
}

function renderNonNullType(
  type: GraphQLType,
  names: ReadonlyMap<string, string>,
  config: NormalizedConfig,
): string {
  if (isNonNullType(type)) return renderNonNullType(type.ofType, names, config);
  if (isListType(type)) {
    return `z.array(${renderListItem(type.ofType, names, config)})`;
  }
  return renderNamedType(type, names, config);
}

function renderListItem(
  type: GraphQLType,
  names: ReadonlyMap<string, string>,
  config: NormalizedConfig,
): string {
  if (isNonNullType(type)) return renderNonNullType(type.ofType, names, config);
  return `${renderNonNullType(type, names, config)}.nullable()${config.nullableWithDefaultNull ? ".default(null)" : ""}`;
}

function renderOutputField(
  type: GraphQLType,
  names: ReadonlyMap<string, string>,
  config: NormalizedConfig,
): string {
  return renderListItem(type, names, config);
}

function renderInputField(
  field: GraphQLInputField,
  names: ReadonlyMap<string, string>,
  config: NormalizedConfig,
): string {
  const required = isNonNullType(field.type);
  const schema = isNonNullType(field.type)
    ? renderNonNullType(field.type.ofType, names, config)
    : `${renderNonNullType(field.type, names, config)}.nullable()`;

  if (field.default !== undefined) {
    return `${schema}.default(${serializeDefault(field)})`;
  }
  if (!required && config.nullableWithDefaultNull) return `${schema}.default(null)`;
  return required ? schema : `${schema}.optional()`;
}

function serializeDefault(field: GraphQLInputField): string {
  const defaultInput = field.default;
  if (defaultInput === undefined) {
    throw new Error(`Input field "${field.name}" does not define a default value.`);
  }

  try {
    if (defaultInput.literal !== undefined) {
      return serializeConstValue(defaultInput.literal);
    }
    return serializeRuntimeValue(defaultInput.value, new Set());
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to emit the default value for input field "${field.parentType.name}.${field.name}": ${reason}`,
    );
  }
}

function serializeConstValue(node: ConstValueNode): string {
  switch (node.kind) {
    case Kind.NULL:
      return "null";
    case Kind.INT:
    case Kind.FLOAT:
      return node.value;
    case Kind.STRING:
    case Kind.ENUM:
      return JSON.stringify(node.value);
    case Kind.BOOLEAN:
      return node.value ? "true" : "false";
    case Kind.LIST:
      return `[${node.values.map(serializeConstValue).join(", ")}]`;
    case Kind.OBJECT:
      return `{ ${node.fields
        .map((field) => `${JSON.stringify(field.name.value)}: ${serializeConstValue(field.value)}`)
        .join(", ")} }`;
  }
}

function serializeRuntimeValue(value: unknown, seen: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("only finite numeric defaults are supported");
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    assertNotCircular(value, seen);
    const rendered = `[${value.map((item) => serializeRuntimeValue(item, seen)).join(", ")}]`;
    seen.delete(value);
    return rendered;
  }
  if (isPlainObject(value)) {
    assertNotCircular(value, seen);
    const rendered = `{ ${Object.entries(value)
      .map(([key, item]) => `${JSON.stringify(key)}: ${serializeRuntimeValue(item, seen)}`)
      .join(", ")} }`;
    seen.delete(value);
    return rendered;
  }
  throw new Error(`unsupported runtime value of type ${typeof value}`);
}

function assertNotCircular(value: object, seen: Set<object>): void {
  if (seen.has(value)) throw new Error("circular defaults are not supported");
  seen.add(value);
}

function referencesGeneratedObject(type: GraphQLType, names: ReadonlyMap<string, string>): boolean {
  if (isNonNullType(type) || isListType(type)) {
    return referencesGeneratedObject(type.ofType, names);
  }
  return names.has(type.name) && (isObjectType(type) || isInputObjectType(type));
}

function referencesCompositeType(type: GraphQLType): boolean {
  if (isNonNullType(type) || isListType(type)) {
    return referencesCompositeType(type.ofType);
  }
  return isObjectType(type) || isInterfaceType(type) || isUnionType(type);
}

function renderField(fieldName: string, expression: string, useGetter: boolean): string[] {
  if (!useGetter) return [`  ${fieldName}: ${expression},`];
  return [`  get ${fieldName}() {`, `    return ${expression};`, "  },"];
}

function renderEnum(type: GraphQLEnumType, name: string, config: NormalizedConfig): string {
  if (config.useTypeScriptEnums) {
    return `export const ${name} = z.enum(${type.name});`;
  }

  const values = type
    .getValues()
    .map((value) => JSON.stringify(value.name))
    .join(", ");
  return `export const ${name} = z.enum([${values}]);`;
}

function renderInputObject(
  type: GraphQLInputObjectType,
  name: string,
  names: ReadonlyMap<string, string>,
  config: NormalizedConfig,
): string {
  const fields = Object.values(type.getFields())
    .filter((field) => config.includeClientMutationId || field.name !== "clientMutationId")
    .flatMap((field) =>
      renderField(
        field.name,
        renderInputField(field, names, config),
        referencesGeneratedObject(field.type, names),
      ),
    );
  return [`export const ${name} = z.object({`, ...fields, "});"].join("\n");
}

function renderObject(
  type: GraphQLObjectType,
  name: string,
  names: ReadonlyMap<string, string>,
  config: NormalizedConfig,
): string {
  const fields: string[] = [];
  if (config.includeTypename) {
    fields.push(`  __typename: z.literal(${JSON.stringify(type.name)}),`);
  }

  for (const field of Object.values(type.getFields())) {
    if (!config.includeRelations && referencesCompositeType(field.type)) {
      continue;
    }
    if (!config.includeClientMutationId && field.name === "clientMutationId") {
      continue;
    }
    fields.push(
      ...renderField(
        field.name,
        renderOutputField(field.type, names, config),
        referencesGeneratedObject(field.type, names),
      ),
    );
  }
  return [`export const ${name} = z.object({`, ...fields, "});"].join("\n");
}

function generate(schema: GraphQLSchema, config: NormalizedConfig): string {
  const types = generatedTypes(schema, config);
  const names = new Map(types.map((type) => [type.name, schemaName(type.name, config)]));
  const definitions = types.map((type) => {
    const name = names.get(type.name);
    if (name === undefined) throw new Error(`Missing schema name for ${type.name}.`);
    if (isEnumType(type)) return renderEnum(type, name, config);
    if (isInputObjectType(type)) {
      return renderInputObject(type, name, names, config);
    }
    if (isObjectType(type)) return renderObject(type, name, names, config);
    throw new Error(`Unsupported generated GraphQL type "${type.name}".`);
  });

  return ['import { z } from "zod";', ...definitions].join("\n\n");
}

export const plugin: PluginFunction<SimpleZodPluginConfig> = (schema, _documents, rawConfig) =>
  generate(schema, assertConfig(schema, rawConfig));

export const validate: PluginValidateFn<SimpleZodPluginConfig> = (
  schema,
  _documents,
  rawConfig,
) => {
  assertConfig(schema, rawConfig);
};
