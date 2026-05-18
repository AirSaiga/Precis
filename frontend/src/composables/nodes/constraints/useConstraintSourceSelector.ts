/**
 * @file useConstraintSourceSelector.ts
 * @description 约束节点源表/源列选择器共享逻辑
 *
 * 提取 Charset、DateLogic、Scripted 等约束节点中重复的
 * availableSourceTables / availableSourceColumns / handleSourceTableChange /
 * handleSourceColumnChange 代码块，消除 ~120 行镜像代码。
 */

import { computed, ref, watch } from 'vue'
import { useGraphStore } from '@/stores/graphStore'

export interface ConstraintSourceSelectorOptions {
  /** 源列变更后的回调（如触发校验） */
  onSourceColumnChange?: () => void | Promise<void>
}

export function useConstraintSourceSelector(
  props: {
    id: string
    data: {
      sourceRef?: { nodeId: string; columnId: string }
      table?: string
      column?: string
    }
  },
  options?: ConstraintSourceSelectorOptions
) {
  const store = useGraphStore()

  const localSourceNodeId = ref<string>('')
  const localSourceColumnId = ref<string>('')

  const availableSourceTables = computed(() => {
    return store.nodes
      .filter((n) => n.type === 'schema')
      .map((n) => ({
        id: n.id,
        tableName: ((n.data as unknown as Record<string, unknown>)?.tableName as string) || n.id,
      }))
  })

  const availableSourceColumns = computed(() => {
    const nodeId = localSourceNodeId.value || props.data.sourceRef?.nodeId
    if (!nodeId) return []
    const node = store.nodes.find((n) => n.id === nodeId)
    if (!node || node.type !== 'schema') return []
    return ((node.data as unknown as Record<string, unknown>).columns || []) as Array<{
      id: string
      columnName: string
    }>
  })

  const handleSourceTableChange = () => {
    const selectedTable = availableSourceTables.value.find((t) => t.id === localSourceNodeId.value)
    store.updateNodeData(props.id, {
      table: selectedTable?.tableName || props.data.table,
      column: '',
      sourceRef: undefined,
      validationStatus: 'idle',
      validationErrors: [],
      lastValidation: undefined,
    })
    localSourceColumnId.value = ''
  }

  const handleSourceColumnChange = async () => {
    if (!localSourceNodeId.value || !localSourceColumnId.value) return
    const selectedCol = availableSourceColumns.value.find((c) => c.id === localSourceColumnId.value)
    store.updateNodeData(props.id, {
      sourceRef: { nodeId: localSourceNodeId.value, columnId: localSourceColumnId.value },
      table:
        availableSourceTables.value.find((t) => t.id === localSourceNodeId.value)?.tableName ||
        props.data.table,
      column: selectedCol?.columnName || props.data.column,
    })
    await options?.onSourceColumnChange?.()
  }

  watch(
    () => props.data.sourceRef?.nodeId,
    (next) => {
      localSourceNodeId.value = next || ''
    },
    { immediate: true }
  )

  watch(
    () => props.data.sourceRef?.columnId,
    (next) => {
      localSourceColumnId.value = next || ''
    },
    { immediate: true }
  )

  return {
    localSourceNodeId,
    localSourceColumnId,
    availableSourceTables,
    availableSourceColumns,
    handleSourceTableChange,
    handleSourceColumnChange,
  }
}
