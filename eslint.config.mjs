import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "output/**",
    "next-env.d.ts",
    // Isolated task checkouts created by `npm run task:start`. They carry other
    // branches' build output, which must never be linted as this tree's source.
    ".codex-worktrees/**",
  ]),
]);

export default eslintConfig;
