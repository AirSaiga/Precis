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
      // 关闭基础从未使用的变量检查
      'no-unused-vars': 'off',
      // 关闭 TypeScript 从未使用的变量检查
      '@typescript-eslint/no-unused-vars': 'off',
      // 当前代码库仍存在较多 any 使用场景，关闭以避免 CI 噪音
      '@typescript-eslint/no-explicit-any': 'off',
      // 允许单文件小组件使用单词组件名
      'vue/multi-word-component-names': 'off',
    },
  },

  eslintConfigPrettier
)
