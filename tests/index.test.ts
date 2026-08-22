import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { codegen } from "@graphql-codegen/core";
import {
  GraphQLInputObjectType,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
  buildASTSchema,
  buildSchema,
  parse,
  type GraphQLSchema as GraphQLSchemaType,
} from "graphql";
import { describe, expect, test } from "vite-plus/test";
import type { ZodType } from "zod";
import { plugin, validate, type BetterZodPluginConfig } from "../src/index.ts";

const schemaSource = /* GraphQL */ `
  scalar DateTime
  scalar JSON

  enum Role {
    ADMIN
    USER
  }

  interface Node {
    id: ID!
  }

  union SearchResult = Post | User

  input FilterInput {
    clientMutationId: String
    createdAfter: DateTime
    flags: [Boolean]
    limit: Int! = 10
    metadata: JSON
    nested: FilterInput
    query: String
    role: Role = USER
    settings: SettingsInput = { active: true, labels: ["featured"] }
  }

  input SettingsInput {
    active: Boolean!
    labels: [String!]!
  }

  type Post implements Node {
    id: ID!
    title: String!
  }

  type User implements Node {
    clientMutationId: String
    friend: User
    id: ID!
    matrix: [[Int!]!]!
    name: String
    node: Node
    posts: [Post!]!
    result: SearchResult
    role: Role!
    tags: [String]
  }

  type Query {
    viewer: User
  }

  type Mutation {
    update(input: FilterInput!): User
  }
`;

const schema = buildSchema(schemaSource);

async function generate(
  graphQLSchema: GraphQLSchemaType = schema,
  config: BetterZodPluginConfig = {},
): Promise<string> {
  const output = await plugin(graphQLSchema, [], config);
  if (typeof output !== "string") {
    throw new TypeError("Expected the plugin to return a string.");
  }
  return output;
}

async function importGenerated(source: string): Promise<Record<string, ZodType>> {
  const directory = await mkdtemp(join(tmpdir(), "better-zod-test-"));
  const filename = join(directory, "schemas.mjs");
  const zodUrl = import.meta.resolve("zod");
  const executableSource = source.replace('from "zod"', `from ${JSON.stringify(zodUrl)}`);

  try {
    await writeFile(filename, executableSource, "utf8");
    return (await import(`${pathToFileURL(filename).href}?test=${crypto.randomUUID()}`)) as Record<
      string,
      ZodType
    >;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("generation", () => {
  test("generates objects, inputs, enums, wrappers, defaults, and recursion", async () => {
    const output = await generate(schema, {
      scalarSchemas: { DateTime: "z.iso.datetime()" },
    });

    expect(output).toContain('import { z } from "zod";');
    expect(output).toContain('export const RoleSchema = z.enum(["ADMIN", "USER"]);');
    expect(output).toContain("export const FilterInputSchema = z.object({");
    expect(output).toContain("createdAfter: z.iso.datetime().nullable().optional(),");
    expect(output).toContain("flags: z.array(z.boolean().nullable()).nullable().optional(),");
    expect(output).toContain("limit: z.number().int().default(10),");
    expect(output).toContain("metadata: z.unknown().nullable().optional(),");
    expect(output).toContain("get nested() {");
    expect(output).toContain("return FilterInputSchema.nullable().optional();");
    expect(output).toContain('role: RoleSchema.nullable().default("USER"),');
    expect(output).toContain("get settings() {");
    expect(output).toContain(
      'return SettingsInputSchema.nullable().default({ "active": true, "labels": ["featured"] });',
    );
    expect(output).toContain("matrix: z.array(z.array(z.number().int())),");
    expect(output).toContain("result: z.unknown().nullable(),");
    expect(output).not.toContain("export const NodeSchema");
    expect(output).not.toContain("export const SearchResultSchema");
    expect(output).not.toContain("export const QuerySchema");
    expect(output).not.toContain("export const MutationSchema");
    expect(output).not.toContain("export const JSONSchema");
    expect(output).not.toContain("clientMutationId:");
  });

  test("applies schema names, typename literals, client mutation IDs, and scalar overrides", async () => {
    const output = await generate(schema, {
      schemaNamePrefix: "Generated",
      schemaNameSuffix: "Validator",
      includeTypename: true,
      includeClientMutationId: true,
      scalarSchemas: {
        ID: "z.string().uuid()",
        String: "z.string().min(1)",
      },
    });

    expect(output).toContain("export const GeneratedUserValidator = z.object({");
    expect(output).toContain('__typename: z.literal("User"),');
    expect(output).toContain("id: z.string().uuid(),");
    expect(output).toContain("name: z.string().min(1).nullable(),");
    expect(output).toContain("clientMutationId: z.string().min(1).nullable().optional(),");
  });

  test("omits composite output fields when relations are disabled", async () => {
    const output = await generate(schema, { includeRelations: false, includeTypename: true });

    expect(output).toContain("export const PostSchema = z.object({");
    expect(output).toContain("export const UserSchema = z.object({");
    expect(output).toContain('__typename: z.literal("User"),');
    expect(output).toContain("id: z.string(),");
    expect(output).toContain("role: RoleSchema,");
    expect(output).toContain("get nested() {");
    expect(output).toContain("get settings() {");
    expect(output).not.toContain("get friend() {");
    expect(output).not.toContain("node: z.unknown().nullable(),");
    expect(output).not.toContain("get posts() {");
    expect(output).not.toContain("result: z.unknown().nullable(),");
  });

  test("includes relations by default and when explicitly enabled", async () => {
    const defaultOutput = await generate();
    const explicitOutput = await generate(schema, { includeRelations: true });

    expect(explicitOutput).toBe(defaultOutput);
    expect(defaultOutput).toContain("get friend() {");
    expect(defaultOutput).toContain("node: z.unknown().nullable(),");
    expect(defaultOutput).toContain("get posts() {");
    expect(defaultOutput).toContain("result: z.unknown().nullable(),");
  });

  test("optionally omits Relay connection and edge object schemas", async () => {
    const relaySchema = buildSchema(/* GraphQL */ `
      type User {
        friends: UserConnection
        id: ID!
      }

      type UserConnection {
        edges: [UserEdge!]!
      }

      type UserEdge {
        node: User
      }

      type EdgeCase {
        value: String
      }

      input PaginationEdge {
        cursor: String
      }

      type Query {
        viewer: User
      }
    `);

    const defaultOutput = await generate(relaySchema);
    const output = await generate(relaySchema, { includeConnectionAndEdgeTypes: false });

    expect(defaultOutput).toContain("export const UserConnectionSchema = z.object({");
    expect(defaultOutput).toContain("export const UserEdgeSchema = z.object({");
    expect(output).not.toContain("export const UserConnectionSchema");
    expect(output).not.toContain("export const UserEdgeSchema");
    expect(output).toContain("friends: z.unknown().nullable(),");
    expect(output).toContain("export const EdgeCaseSchema = z.object({");
    expect(output).toContain("export const PaginationEdgeSchema = z.object({");
  });
});

describe("runtime schemas", () => {
  test("parses complete objects while enforcing nullable and recursive fields", async () => {
    const generated = await importGenerated(await generate());
    const user = {
      id: "user-1",
      matrix: [[1, 2]],
      name: null,
      result: { any: "abstract value" },
      role: "ADMIN",
      tags: ["one", null],
      friend: null,
      node: null,
      posts: [],
    };

    expect(generated.UserSchema?.parse(user)).toEqual(user);
    expect(() => generated.UserSchema?.parse({ ...user, name: undefined })).toThrow();
    expect(() => generated.UserSchema?.parse({ ...user, matrix: [[null]] })).toThrow();
  });

  test("applies input defaults and optional GraphQL input semantics", async () => {
    const generated = await importGenerated(await generate());
    const result = generated.FilterInputSchema?.parse({});

    expect(result).toMatchObject({
      limit: 10,
      role: "USER",
      settings: { active: true, labels: ["featured"] },
    });
    expect(generated.FilterInputSchema?.parse({ query: null })).toMatchObject({
      query: null,
    });
  });

  test("requires the configured concrete typename", async () => {
    const generated = await importGenerated(await generate(schema, { includeTypename: true }));
    const user = {
      __typename: "User",
      id: "user-1",
      matrix: [],
      name: null,
      result: null,
      role: "USER",
      tags: null,
      friend: null,
      node: null,
      posts: [],
    };

    expect(generated.UserSchema?.parse(user)).toEqual(user);
    expect(() => generated.UserSchema?.parse({ ...user, __typename: "Post" })).toThrow();
    const { __typename: _typename, ...withoutTypename } = user;
    expect(() => generated.UserSchema?.parse(withoutTypename)).toThrow();
  });
});

describe("validation", () => {
  test("rejects invalid options and generated identifiers", () => {
    expect(() =>
      validate(
        schema,
        [],
        { includeTypename: "yes" } as unknown as BetterZodPluginConfig,
        "schemas.ts",
        [],
      ),
    ).toThrow('"includeTypename" must be a boolean');
    expect(() =>
      validate(
        schema,
        [],
        { includeRelations: "yes" } as unknown as BetterZodPluginConfig,
        "schemas.ts",
        [],
      ),
    ).toThrow('"includeRelations" must be a boolean');
    expect(() =>
      validate(
        schema,
        [],
        { includeConnectionAndEdgeTypes: "no" } as unknown as BetterZodPluginConfig,
        "schemas.ts",
        [],
      ),
    ).toThrow('"includeConnectionAndEdgeTypes" must be a boolean');
    expect(() => validate(schema, [], { scalarSchemas: { JSON: "" } }, "schemas.ts", [])).toThrow(
      '"scalarSchemas.JSON" must be a non-empty string',
    );
    expect(() => validate(schema, [], { schemaNamePrefix: "invalid-" }, "schemas.ts", [])).toThrow(
      "is not a valid TypeScript identifier",
    );
  });

  test("rejects the Zod import collision", async () => {
    const collisionSchema = buildSchema("type z { value: String } type Query { z: z }");
    await expect(generate(collisionSchema, { schemaNameSuffix: "" })).rejects.toThrow(
      "conflicts with the Zod import",
    );
  });

  test("reports unsupported programmatic defaults", async () => {
    const Input = new GraphQLInputObjectType({
      name: "Input",
      fields: {
        value: {
          type: GraphQLString,
          default: { value: 1n },
        },
      },
    });
    const Query = new GraphQLObjectType({
      name: "Query",
      fields: { ok: { type: GraphQLString } },
    });
    const programmaticSchema = new GraphQLSchema({ query: Query, types: [Input] });

    await expect(generate(programmaticSchema)).rejects.toThrow(
      'Unable to emit the default value for input field "Input.value"',
    );
  });
});

test("runs through GraphQL Codegen core", async () => {
  const schemaDocument = parse(schemaSource);
  const schemaAst = buildASTSchema(schemaDocument);
  const output = await codegen({
    filename: "schemas.ts",
    schema: schemaDocument,
    schemaAst,
    documents: [],
    config: {},
    plugins: [{ betterZod: { includeTypename: true } }],
    pluginMap: { betterZod: { plugin, validate } },
  });

  expect(output).toContain("export const UserSchema = z.object({");
  expect(output).toContain('__typename: z.literal("User"),');
});
