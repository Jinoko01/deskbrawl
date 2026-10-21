import js from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["dist/**", "src-tauri/**"]),
  {
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
  },
  {
    files: ["**/*.{ts,tsx}", "*.config.js"],
    extends: [stylistic.configs.customize({
      indent: 2,
      quotes: "double",
      semi: true,
      jsx: true,
      arrowParens: true,
      braceStyle: "1tbs",
    })],
    rules: {
      "@stylistic/brace-style": ["error", "1tbs", { allowSingleLine: false }],
      "@stylistic/max-statements-per-line": ["error", { max: 1 }],
      "@stylistic/jsx-max-props-per-line": ["error", { maximum: { single: 2, multi: 1 } }],
      "@stylistic/jsx-one-expression-per-line": ["error", { allow: "single-child" }],
      "@stylistic/object-property-newline": ["error", { allowAllPropertiesOnSameLine: true }],
      "@stylistic/operator-linebreak": ["error", "before", { overrides: { "=": "after" } }],
      "@stylistic/object-curly-newline": ["error", {
        ObjectExpression: { minProperties: 4, multiline: true, consistent: true },
        ObjectPattern: { minProperties: 4, multiline: true, consistent: true },
        ImportDeclaration: { minProperties: 4, multiline: true, consistent: true },
        ExportDeclaration: { multiline: true, consistent: true },
      }],
      "one-var": ["error", "never"],
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "separate-type-imports" }],
      "@typescript-eslint/no-non-null-assertion": "error",
      "curly": ["error", "all"],
      "eqeqeq": ["error", "always"],
      "no-else-return": "error",
      "no-nested-ternary": "error",
      "object-shorthand": "error",
      "prefer-template": "error",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/native/**"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["@tauri-apps/*"],
          message: "Tauri API는 src/native 어댑터에서만 사용하세요.",
        }],
      }],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ["*.config.{js,ts}"],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },
]);
