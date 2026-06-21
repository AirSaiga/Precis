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
      // TODO: 待专项清理后开启
      // 当前代码库约 376 处 any（96 文件 :any + 31 文件 as any），
      // 开启 error 会 CI 全红。清理路径：按目录分批替换为精确类型/unknown + 类型守卫。
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      // 允许单文件小组件使用单词组件名
      'vue/multi-word-component-names': 'off',
    },
  },

  eslintConfigPrettier
)
