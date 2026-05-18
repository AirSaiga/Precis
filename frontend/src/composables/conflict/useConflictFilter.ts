/**
 * @file useConflictFilter.ts
 * @description 冲突项过滤组合式函数
 *
 * 功能概述:
 * - 提供冲突项的搜索文本和状态筛选状态管理
 * - 根据筛选条件过滤 Schema、Constraint、RegexNode 列表
 * - 统计过滤后的总数、新增数、修改数
 *
 * 架构设计:
 * - 接收 ConfigComparison 作为输入
 * - 导出响应式筛选条件和过滤后的计算属性
 * - 导出 matchesFilter 工具函数供批量操作使用
 *
 * 输入示例:
 *   const { filteredSchemas, searchText, statusFilter, totalCount } = useConflictFilter(comparison)
 *
 * 输出示例:
 *   filteredSchemas.value -> ConfigItemDiff<unknown>[]
 *   totalCount.value -> number
 */

import { ref, computed } from 'vue'
import type { ConfigComparison, ConfigItemDiff } from '@/api/types/conflict'

export function useConflictFilter(comparison: ConfigComparison) {
  const searchText = ref('')
  const statusFilter = ref<'all' | 'added' | 'modified'>('all')

  const matchesFilter = (item: ConfigItemDiff<unknown>) => {
    const typeOk = statusFilter.value === 'all' ? true : item.type === statusFilter.value
    if (!typeOk) return false
    const q = (searchText.value || '').trim().toLowerCase()
    if (!q) return true
    return String(item.name || '').toLowerCase().includes(q) || String(item.id || '').toLowerCase().includes(q)
  }

  const filteredSchemas = computed(() => comparison.schemas.filter(matchesFilter))
  const filteredConstraints = computed(() => comparison.constraints.filter(matchesFilter))
  const filteredRegexNodes = computed(() => comparison.regex_nodes.filter(matchesFilter))

  const totalCount = computed(() => {
    return filteredSchemas.value.length + filteredConstraints.value.length + filteredRegexNodes.value.length
  })

  const addedCount = computed(() => {
    return [...filteredSchemas.value, ...filteredConstraints.value, ...filteredRegexNodes.value]
      .filter(i => i.type === 'added').length
  })

  const modifiedCount = computed(() => {
    return [...filteredSchemas.value, ...filteredConstraints.value, ...filteredRegexNodes.value]
      .filter(i => i.type === 'modified').length
  })

  return {
    searchText,
    statusFilter,
    matchesFilter,
    filteredSchemas,
    filteredConstraints,
    filteredRegexNodes,
    totalCount,
    addedCount,
    modifiedCount,
  }
}
