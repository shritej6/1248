import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

const vision = {
  rules: {
    "no-comments": {
      meta: {
        type: "problem",
        schema: [],
        messages: {
          comment: "Code comments are not allowed. Put the reason in the commit message or the docs.",
        },
      },
      create(context) {
        return {
          Program() {
            for (const comment of context.sourceCode.getAllComments()) {
              context.report({ loc: comment.loc, messageId: "comment" });
            }
          },
        };
      },
    },
  },
};

const shared = {
  plugins: { vision },
  linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "error" },
  rules: {
    "vision/no-comments": "error",
    "max-lines": ["error", { max: 500 }],
    "max-lines-per-function": ["error", { max: 40 }],
    "no-var": "error",
    "prefer-const": "error",
  },
};

const nodeGlobals = { process: "readonly", console: "readonly", URL: "readonly" };

export default defineConfig(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.wrangler/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "apps/android/**",
      "exam/data/**",
      "exam/results/**",
      "google/**",
    ],
  },
  {
    files: ["**/*.{js,mjs}"],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: nodeGlobals },
    ...shared,
  },
  {
    files: ["**/*.{ts,tsx,mts}"],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    ...shared,
  },
  {
    files: ["packages/core/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(node:|cloudflare:|fs$|path$|http$|https$|net$|crypto$)",
              message: "core has no I/O.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["exam/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [{ regex: "^\\.\\./\\.\\./", message: "Import another package by its name." }],
        },
      ],
    },
  },
);
