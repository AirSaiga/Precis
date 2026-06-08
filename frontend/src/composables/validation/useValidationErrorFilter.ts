/**
 * 校验错误过滤组合式函数
 *
 * 提供按阶段过滤（all/loading/format/constraint）、搜索过滤、
 * 按表/阶段/类型/无分组的能力。
 */
import { computed, ref } from 'vue'
import type { FullValidationErrorItem } from '@/api/projectValidationApi'

export type ErrorStageFilter = 'all' | 'loading' | 'format' | 'constraint'
export type ErrorGroupBy = 'table' | 'stage' | 'type' | 'none'

/** @returns stageFilter / groupBy / searchQuery 响应式状态及过滤/分组计算属性 */
export function useValidationErrorFilter<T extends FullValidationErrorItem>(errors: T[]) {
  const stageFilter = ref<ErrorStageFilter>('all')
  const groupBy = ref<ErrorGroupBy>('table')
  const searchQuery = ref('')

  const filteredErrors = computed(() => {
    let result = [...errors]

    // Stage filter
    if (stageFilter.value !== 'all') {
      result = result.filter((e) => e.stage === stageFilter.value)
    }

    // Search filter
    if (searchQuery.value.trim()) {
      const query = searchQuery.value.toLowerCase()
      result = result.filter(
        (e) =>
          e.message.toLowerCase().includes(query) ||
          (e.table?.toLowerCase() || '').includes(query) ||
          (e.column?.toLowerCase() || '').includes(query) ||
          (e.error_type?.toLowerCase() || '').includes(query) ||
          (e.check_type?.toLowerCase() || '').includes(query)
      )
    }

    return result
  })

  const groupedErrors = computed(() => {
    const items = filteredErrors.value
    if (groupBy.value === 'none') {
      return { 全部错误: items }
    }

    const groups: Record<string, T[]> = {}

    for (const item of items) {
      let key: string
      switch (groupBy.value) {
        case 'table':
          key = item.table || item.source_file?.split(/[\\/]/).pop() || '未知表'
          break
        case 'stage':
          key = item.stage
          break
        case 'type':
          key = item.check_type || item.error_type || '未知类型'
          break
        default:
          key = '全部错误'
      }

      if (!groups[key]) {
        groups[key] = []
      }
      const bucket = groups[key]
      if (bucket) {
        bucket.push(item)
      }
    }

    return groups
  })

  return {
    stageFilter,
    groupBy,
    searchQuery,
    filteredErrors,
    groupedErrors,
  }
}
