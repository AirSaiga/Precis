/**
 * @file expressionStore.ts
 * @description 表达式规则管理 Store
 *
 * 管理表达式解析规则（Pattern）的加载、保存和编辑状态。
 * 支持正则表达式模式的定义、输出模板配置以及规则的增删改查。
 *
 * 核心功能：
 * - fetchExpressions: 从 API 加载表达式规则列表（当前为模拟数据）
 * - saveExpressions: 保存表达式规则到后端
 * - addRule: 添加新的表达式规则
 * - patternNames: 计算属性，获取所有规则名称
 *
 * 数据结构：
 * - ExpressionRule: { name, regex, output }
 * - 正则支持命名捕获组，output 支持模板变量替换
 */

import { logger } from '@/core/utils/logger'
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { toastSuccess } from '@/core/toast'

const mockApiData = {
  patterns: [
    { name: 'gt_int', regex: '>(?P<value>\\d+)', output: { op: '>', value: '{value:int}' } },
  ],
}

export interface ExpressionRule {
  name: string
  regex: string
  output: Record<string, unknown>
}

export const useExpressionStore = defineStore('expressions', () => {
  const { t } = useI18n()
  const patterns = ref<ExpressionRule[]>([])
  const isLoading = ref(false)

  const patternNames = computed(() => patterns.value.map((p) => p.name))

  async function fetchExpressions() {
    logger.debug('Fetching expressions from API...')
    isLoading.value = true
    await new Promise((resolve) => setTimeout(resolve, 500))
    patterns.value = mockApiData.patterns
    isLoading.value = false
    logger.debug('Expressions loaded.')
  }

  async function saveExpressions() {
    logger.debug('Saving expressions to API...')
    isLoading.value = true
    await new Promise((resolve) => setTimeout(resolve, 500))
    logger.debug('Saved data:', { patterns: patterns.value })
    isLoading.value = false
    toastSuccess(t('messages.success.expressionSaved'))
  }

  function addRule(type: 'patterns') {
    const newRule = { name: 'new_rule', regex: '', output: {} }
    if (type === 'patterns') {
      // [safe-push] patterns 是独立的响应式数组，非 Vue Flow 节点/边
      patterns.value.push(newRule)
    }
    return newRule
  }

  return {
    patterns,
    isLoading,
    patternNames,
    fetchExpressions,
    saveExpressions,
    addRule,
  }
})
