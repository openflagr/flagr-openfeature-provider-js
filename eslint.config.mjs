import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  // Ignore patterns
  {
    ignores: [
      '**/.next/**',
      '**/dist/**',
      '**/node_modules/**',
      '**/*.js',
      '**/*.mjs',
      'coverage/**',
      '**/*.md',
    ],
  },

  // Base ESLint recommended rules
  eslint.configs.recommended,

  // TypeScript-ESLint strict + type-checked rules
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // TypeScript parser options for type-aware linting
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Project-specific rule overrides (if needed)
  {
    rules: {
      // Customize rules here as needed
    },
  },

  // Prettier must be last to override conflicting rules
  eslintConfigPrettier
);
