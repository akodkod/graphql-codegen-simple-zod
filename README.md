# graphql-codegen-simple-zod

A small [GraphQL Code Generator](https://the-guild.dev/graphql/codegen) plugin that creates [Zod 4](https://zod.dev/) schemas for GraphQL objects, inputs, and enums.

## Disclaimer

This project was built for internal company use, and its code was generated using AI. Use it at your own risk.

It is provided as-is. There are no plans to support or maintain this library. If you want to use it, forking the repository and maintaining your own version is recommended.

## Install

```bash
pnpm add graphql zod
pnpm add -D @graphql-codegen/cli graphql-codegen-simple-zod
```

## Use

Add the plugin to your GraphQL Code Generator config:

```ts
import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
  schema: "./schema.graphql",
  generates: {
    "./src/generated/schemas.ts": {
      plugins: [
        {
          "graphql-codegen-simple-zod": {
            includeTypename: false,
            includeRelations: true,
            scalarSchemas: {
              DateTime: "z.iso.datetime()",
              JSON: "z.unknown()",
            },
          },
        },
      ],
    },
  },
};

export default config;
```

Then run GraphQL Code Generator:

```bash
pnpm graphql-codegen --config codegen.ts
```

## Options

| Option                          | Default    | What it does                                                  |
| ------------------------------- | ---------- | ------------------------------------------------------------- |
| `schemaNamePrefix`              | `""`       | Adds a prefix to generated schema names.                      |
| `schemaNameSuffix`              | `"Schema"` | Adds a suffix to generated schema names.                      |
| `includeTypename`               | `false`    | Adds a required `__typename` literal.                         |
| `includeClientMutationId`       | `false`    | Includes `clientMutationId` fields.                           |
| `includeRelations`              | `true`     | Includes object, interface, and union fields.                 |
| `includeConnectionAndEdgeTypes` | `true`     | Generates Relay-style `Connection` and `Edge` object schemas. |
| `scalarSchemas`                 | `{}`       | Maps scalar names to Zod expressions.                         |

Built-in scalars map to their usual Zod types. Unknown custom scalars use `z.unknown()` unless they are configured in `scalarSchemas`.

Query, Mutation, Subscription, interface, and union schemas are not generated. References to interfaces or unions use `z.unknown()`.

## Development

```bash
vp install
vp check
vp test
vp run build
```
