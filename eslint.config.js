import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: ['out', 'dist', 'node_modules', 'coverage', 'tmp', 'test-results', 'playwright-report']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser
      }
    }
  },
  {
    files: ['src/renderer/**/*.{ts,vue}', 'tests/unit/components.test.ts'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        Event: 'readonly',
        File: 'readonly',
        DragEvent: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLSelectElement: 'readonly'
      }
    }
  },
  {
    rules: {
      'vue/multi-word-component-names': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly'
      }
    }
  },
  prettier
)
