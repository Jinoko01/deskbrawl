import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import prettierRecommended from 'eslint-plugin-prettier/recommended';

export default defineConfig([
  globalIgnores(['dist/**', 'src/generated/**']),
  {
    files: ['**/*.{js,mjs,cjs,ts}'],
    extends: [js.configs.recommended],
  },
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        { allowExpressions: true },
      ],
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },
  {
    files: ['test/**/*.cjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        beforeAll: 'readonly',
        beforeEach: 'readonly',
        afterAll: 'readonly',
        afterEach: 'readonly',
        test: 'readonly',
        expect: 'readonly',
      },
    },
  },
  prettierRecommended,
  {
    files: ['**/*.{js,mjs,cjs,ts}'],
    // Keep control-flow rules after the formatter's conflict-disabling preset.
    rules: {
      curly: ['error', 'all'],
      eqeqeq: ['error', 'always'],
      'no-nested-ternary': 'error',
      'max-classes-per-file': ['error', 1],
      'max-statements-per-line': ['error', { max: 1 }],
    },
  },
]);
