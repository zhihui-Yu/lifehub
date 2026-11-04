import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

/**
 * ESLint 9 flat config。
 * 关键约束（对应系统设计 §8.4 类型纪律）：
 * - `@typescript-eslint/no-explicit-any` 为 error（禁止 any）
 * - `@typescript-eslint/no-non-null-assertion` 为 error（禁止 `!` 断言）
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/android/**',
      '**/ios/**',
      '**/coverage/**',
      '**/coverage-*/**',
      '**/.qa-*/**',
      'apps/sync-server/**',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...(reactRefresh.configs?.vite?.rules ?? {}),
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-undef': 'off',
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-undef': 'error',
    },
  },
  {
    // 测试与测试辅助文件不参与 Vite 的 Fast Refresh，
    // 因此 `react-refresh/only-export-components` 对它们没有意义 ——
    // 测试辅助常常需要在同一文件里同时导出组件与渲染函数。
    files: ['**/__tests__/**/*.{ts,tsx}', '**/test-utils/**/*.{ts,tsx}', '**/*.test.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
);
