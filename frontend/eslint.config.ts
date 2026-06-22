import { globalIgnores } from 'eslint/config'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'
import eslintConfigPrettier from 'eslint-config-prettier'

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{ts,mts,tsx,vue}'],
  },

  globalIgnores(['**/dist/**', '**/dist-ssr/**', '**/coverage/**']),

  pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,

  {
    rules: {
      // A2 专项：any 已清理完毕，开启 error 防止回退
      '@typescript-eslint/no-explicit-any': 'error',
      // 关闭基础 no-unused-vars，使用 TypeScript 版本避免 enum/interface 误报
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          vars: 'all',
          args: 'none',
          ignoreRestSiblings: true,
          caughtErrors: 'none',
          varsIgnorePattern: '^_',
        },
      ],
      // 允许单文件小组件使用单词组件名
      'vue/multi-word-component-names': 'off',
    },
  },

  // 测试文件暂不强制 no-unused-vars / no-explicit-any
  {
    files: ['tests/**/*.{ts,mts,tsx,vue}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },

  eslintConfigPrettier
)
