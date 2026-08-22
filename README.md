# graphql-codegen-better-zod

An ESM [GraphQL Code Generator](https://the-guild.dev/graphql/codegen) plugin that generates [Zod 4](https://zod.dev/) schema constants from GraphQL object types, input objects, and enums.

## Installation

Install the plugin together with its GraphQL and Zod peer dependencies:

```bash
pnpm add graphql zod
pnpm add -D @graphql-codegen/cli graphql-codegen-better-zod
```

## Configuration

### TypeScript

```ts
import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
  schema: "./schema.graphql",
  generates: {
    "./src/generated/schemas.ts": {
      plugins: [
        {
          "graphql-codegen-better-zod": {
            schemaNamePrefix: "",
            schemaNameSuffix: "Schema",
            includeTypename: false,
            includeClientMutationId: false,
            scalarSchemas: {
              JSON: "z.unknown()",
              DateTime: "z.iso.datetime()",
              ISO8601DateTime: "z.date()",
            },
          },
        },
      ],
    },
  },
};

export default config;
```

### YAML

```yaml
schema: ./schema.graphql
generates:
  ./src/generated/schemas.ts:
    plugins:
      - graphql-codegen-better-zod:
          includeTypename: true
          scalarSchemas:
            JSON: z.unknown()
            DateTime: z.iso.datetime()
```

Run GraphQL Code Generator as usual:

```bash
pnpm graphql-codegen --config codegen.ts
```

## Options

| Option                    | Type                     | Default    | Description                                                               |
| ------------------------- | ------------------------ | ---------- | ------------------------------------------------------------------------- |
| `schemaNamePrefix`        | `string`                 | `""`       | Prepends text to every generated schema name.                             |
| `schemaNameSuffix`        | `string`                 | `"Schema"` | Appends text to every generated schema name.                              |
| `includeTypename`         | `boolean`                | `false`    | Adds a required concrete `__typename` literal to object schemas.          |
| `includeClientMutationId` | `boolean`                | `false`    | Includes fields whose exact name is `clientMutationId`.                   |
| `scalarSchemas`           | `Record<string, string>` | `{}`       | Overrides built-in or custom scalar schemas with trusted Zod expressions. |

The built-in scalar mappings are:

| GraphQL scalar | Zod schema         |
| -------------- | ------------------ |
| `String`       | `z.string()`       |
| `ID`           | `z.string()`       |
| `Int`          | `z.number().int()` |
| `Float`        | `z.number()`       |
| `Boolean`      | `z.boolean()`      |

Custom scalars not present in `scalarSchemas` use `z.unknown()`.

## Generated output

Given:

```graphql
enum Role {
  ADMIN
  USER
}

input UserFilter {
  limit: Int! = 10
  role: Role
}

type User {
  id: ID!
  friend: User
  name: String
  role: Role!
}
```

the plugin generates:

```ts
import { z } from "zod";

export const RoleSchema = z.enum(["ADMIN", "USER"]);

export const UserFilterSchema = z.object({
  limit: z.number().int().default(10),
  role: RoleSchema.nullable().optional(),
});

export const UserSchema = z.object({
  get friend() {
    return UserSchema.nullable();
  },
  id: z.string(),
  name: z.string().nullable(),
  role: RoleSchema,
});
```

Recursive object and input references use Zod 4 shape getters. Nullable output fields accept `null` but remain required. Nullable input fields accept `null` or omission, and GraphQL input defaults are emitted with `.default(...)`.

## Scope and limitations

- Query, Mutation, and Subscription root types are not generated.
- Introspection types, scalar declarations, interfaces, and unions are not generated.
- Fields that reference interfaces or unions use `z.unknown()` while preserving list and nullability wrappers.
- Schemas describe complete GraphQL object types, not operation-specific selection results.
- Directives, descriptions, operation documents, and GraphQL's singleton-to-list input coercion are not reflected.
- `scalarSchemas` values are inserted verbatim and must be valid expressions using the generated `z` import.
- GraphQL input defaults must be representable as GraphQL literals or supported JavaScript primitives, arrays, and plain objects.

## Development

The project uses [Vite+](https://viteplus.dev/guide/) for dependency management, checks, tests, and packaging.

```bash
vp install
vp check
vp test
vp run build
```
