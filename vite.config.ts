import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    // Keep GraphQL and Codegen on the same module instance during integration tests.
    server: {
      deps: {
        inline: [/graphql/],
      },
    },
  },
  staged: {
    "*": "vp check --fix",
  },
  pack: {
    dts: {
      tsgo: true,
    },
    exports: true,
    publint: {
      level: "error",
    },
    attw: {
      profile: "esm-only",
      level: "error",
    },
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
