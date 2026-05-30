import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '../AYLink.Agent/www/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/essential'],
  {
    files: ['**/*.{ts,tsx,vue}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-alert': 'warn',
      'no-var': 'error',
      'prefer-const': 'error',
      'vue/multi-word-component-names': 'off',
      '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  }
  ,
  {
    files: ['src/views/**/*.ts'],
    rules: {
      // 第一阶段先收口基础设施层，避免对现有大体量页面进行高噪音改造。
      eqeqeq: 'off',
      'no-empty': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  }
);
