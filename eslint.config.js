const tseslint = require('typescript-eslint');
const prettier = require('eslint-config-prettier/flat');

module.exports = tseslint.config(
  {
    ignores: ['src/generated/**', '**/*.spec.ts', 'dist/**'],
  },
  tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
        sourceType: 'module',
      },
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  prettier,
);
