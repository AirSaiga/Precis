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
      // 类型安全纪律：as unknown as 双重断言是类型安全逃生舱（绕过 discriminated union）。
      // warn 级别 + lint:check 的 --max-warnings 阈值控制增量：新增一个会让 warning 数超过阈值而 CI 失败。
      // 渐进清理目标：逐步用类型守卫替代，降低阈值直至归零。
      'no-restricted-syntax': [
        'warn',
        {
          selector: 'TSAsExpression[expression.type="TSAsExpression"]',
          message:
            "避免 'as unknown as' 双重断言（类型安全逃生舱），优先用类型守卫或正确的类型标注。如必须使用请加注释说明原因。",
        },
      ],
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

  // 测试文件暂不强制 no-unused-vars / no-explicit-any / 双重断言限制
  {
    files: ['tests/**/*.{ts,mts,tsx,vue}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-restricted-syntax': 'off',
    },
  },

  eslintConfigPrettier
)
