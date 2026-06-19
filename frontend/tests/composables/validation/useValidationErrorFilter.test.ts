import { describe, it, expect, beforeEach } from 'vitest'
import { computed, ref, nextTick } from 'vue'
import {
  useValidationErrorFilter,
  type ErrorStageFilter,
  type ErrorGroupBy,
} from '@/composables/validation/useValidationErrorFilter'
import type { FullValidationErrorItem } from '@/api/projectValidationApi'

function makeError(overrides?: Partial<FullValidationErrorItem>): FullValidationErrorItem {
  return {
    stage: 'constraint',
    error_type: 'NotNull',
    message: 'value is null',
    table: 'users',
    column: 'name',
    check_type: 'NotNull',
    ...overrides,
  }
}

describe('useValidationErrorFilter', () => {
  beforeEach(() => {
    // 每个用例独立，通过重新创建 composable 实例保证隔离
  })

  it('accepts a plain array and returns default filter state', () => {
    const errors = [makeError()]
    const filter = useValidationErrorFilter(errors)

    expect(filter.stageFilter.value).toBe('all')
    expect(filter.groupBy.value).toBe('table')
    expect(filter.searchQuery.value).toBe('')
    expect(filter.groupedErrors.value).toHaveProperty('users')
  })

  it('accepts a ref and reacts to array changes', async () => {
    const errors = ref<FullValidationErrorItem[]>([makeError({ table: 'users' })])
    const filter = useValidationErrorFilter(errors)

    expect(filter.groupedErrors.value).toHaveProperty('users')

    errors.value = [makeError({ table: 'orders' })]
    await nextTick()

    expect(filter.groupedErrors.value).not.toHaveProperty('users')
    expect(filter.groupedErrors.value).toHaveProperty('orders')
  })

  it('accepts a computed ref and reacts to dependency changes', async () => {
    const raw = ref<FullValidationErrorItem[]>([makeError({ table: 'users' })])
    const errors = computed(() => raw.value)
    const filter = useValidationErrorFilter(errors)

    expect(filter.groupedErrors.value).toHaveProperty('users')

    raw.value = [makeError({ table: 'products' })]
    await nextTick()

    expect(filter.groupedErrors.value).toHaveProperty('products')
  })

  it('filters by stage', async () => {
    const errors = [
      makeError({ stage: 'format', table: 'users' }),
      makeError({ stage: 'constraint', table: 'orders' }),
    ]
    const filter = useValidationErrorFilter(errors)

    filter.stageFilter.value = 'format' as ErrorStageFilter
    await nextTick()

    expect(filter.filteredErrors.value).toHaveLength(1)
    expect(filter.filteredErrors.value[0].stage).toBe('format')
  })

  it('filters by search query across message/table/column', async () => {
    const errors = [
      makeError({ message: 'email invalid', table: 'users', column: 'email' }),
      makeError({ message: 'age too small', table: 'orders', column: 'age' }),
    ]
    const filter = useValidationErrorFilter(errors)

    filter.searchQuery.value = 'orders'
    await nextTick()

    expect(filter.filteredErrors.value).toHaveLength(1)
    expect(filter.filteredErrors.value[0].table).toBe('orders')
  })

  it('groups by stage when requested', async () => {
    const errors = [makeError({ stage: 'format' }), makeError({ stage: 'constraint' })]
    const filter = useValidationErrorFilter(errors)

    filter.groupBy.value = 'stage' as ErrorGroupBy
    await nextTick()

    expect(filter.groupedErrors.value).toHaveProperty('format')
    expect(filter.groupedErrors.value).toHaveProperty('constraint')
  })
})
