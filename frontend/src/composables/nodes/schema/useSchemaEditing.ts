/**
 * @file useSchemaEditing.ts
 * @description Schema编辑逻辑
 * 负责表名编辑、列编辑、约束编辑、数据类型切换
 */

import { logger } from '@/core/utils/logger'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVueFlow } from '@vue-flow/core'
import { useGraphStore } from '@/stores/graphStore'
import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
import type { SchemaNodeData, SchemaColumn, DataType } from '@/types/graph'
import { dispatchValidation } from '@/services/constraints/orchestration/globalValidation'
import { getSchemaNodeSourceInfo } from '@/services/constraints/orchestration/validationCollector'
import { useNodeColumnEditing } from '../shared/useNodeColumnEditing'

export function useSchemaEditing(props: { id: string; data: SchemaNodeData }, emit: any) {
  const { t } = useI18n()
  const { updateNodeData } = useVueFlow()
  const { showConfirm } = useGlobalConfirm()
  const store = useGraphStore()

  // ============================================================================
  // 列编辑通用逻辑
  // ============================================================================

  const genericEditing = useNodeColumnEditing<SchemaColumn>(props, emit, {
    findColumn: (id) => props.data.columns.find((c) => c.id === id),
    createColumn: (partial) =>
      ({
        id: partial.id || `col-${Date.now()}`,
        columnName: partial.columnName || 'New Column',
        dataType: (partial.dataType as DataType) || 'String',
        expressionType: 'none',
        validationErrors: [],
        ...partial,
      }) as SchemaColumn,
    supportsNested: false,
    updateColumns: (columns) => {
      updateNodeData(props.id, {
        ...props.data,
        columns,
        saveState: 'draft',
        updatedAt: new Date().toISOString(),
      })
    },
    validateColumnName: (columnId, newName) => {
      const isDuplicate = props.data.columns.some(
        (col) => col.id !== columnId && col.columnName.toLowerCase() === newName.toLowerCase()
      )
      return isDuplicate ? t('customNodes.schemaNode.validation.columnNameDuplicate') : undefined
    },
    generateDefaultName: (columnId, columns) => {
      const colIndex = columns.findIndex((c) => c.id === columnId)
      return `column_${colIndex + 1}`
    },
    beforeDeleteColumn: async () => {
      const result = await showConfirm({
        title: t('common.confirmDialog.title'),
        message: t('customNodes.schemaNode.validation.deleteColumnConfirm'),
        type: 'warning',
      })
      return result === true
    },
    onDeleteColumn: (columnId) => {
      emit('delete-column', columnId)
    },
    tabNavigates: false,
  })

  // 映射通用状态到 Schema 命名
  const editingColumn = genericEditing.editingColumnId
  const editingColumnName = genericEditing.editingColumnText
  const columnInputRefs = genericEditing.columnInputRefs
  const setInputRef = genericEditing.setInputRef
  const startColumnEdit = genericEditing.startColumnEdit

  // ============================================================================
  // 列编辑（Schema 特有行为封装）
  // ============================================================================

  const confirmColumnEdit = (columnId: string, newName?: string) => {
    genericEditing.confirmColumnEdit(columnId, newName)

    // 如果编辑状态仍未清除，说明校验失败
    if (editingColumn.value) {
      showColumnError(columnId, t('customNodes.schemaNode.validation.columnNameDuplicate'))
      return
    }

    // 成功确认后清除该列的验证错误
    const col = props.data.columns.find((c) => c.id === columnId)
    if (col?.validationErrors?.length) {
      const updatedColumns = props.data.columns.map((c) =>
        c.id === columnId ? { ...c, validationErrors: [] } : c
      )
      updateNodeData(props.id, {
        ...props.data,
        columns: updatedColumns,
        saveState: 'draft',
        updatedAt: new Date().toISOString(),
      })
    }
  }

  const cancelColumnEdit = (columnId: string) => {
    genericEditing.cancelColumnEdit()
    const updatedColumns = props.data.columns.map((col) =>
      col.id === columnId ? { ...col, validationErrors: [] } : col
    )
    updateNodeData(props.id, { ...props.data, columns: updatedColumns })
  }

  const showColumnError = (columnId: string, errorMessage: string) => {
    const translatedMessage = errorMessage.includes('customNodes') ? t(errorMessage) : errorMessage
    const updatedColumns = props.data.columns.map((col) =>
      col.id === columnId ? { ...col, validationErrors: [translatedMessage] } : col
    )
    updateNodeData(props.id, { ...props.data, columns: updatedColumns })
  }

  const deleteColumn = genericEditing.deleteColumn

  const onColumnEnter = (id: string) => {
    confirmColumnEdit(id)
  }

  const onColumnTab = (id: string) => {
    confirmColumnEdit(id)
  }

  // ============================================================================
  // 约束管理
  // ============================================================================

  const toggleConstraint = (columnId: string, constraintType: 'notNull' | 'unique') => {
    let wasAdded = false

    const updatedColumns = props.data.columns.map((col) => {
      if (col.id === columnId) {
        const currentConstraints = col.constraints || {}
        wasAdded = !currentConstraints[constraintType]
        return {
          ...col,
          constraints: {
            ...currentConstraints,
            [constraintType]: !currentConstraints[constraintType],
          },
        }
      }
      return col
    })

    updateNodeData(props.id, {
      ...props.data,
      columns: updatedColumns,
      saveState: 'draft',
      updatedAt: new Date().toISOString(),
    })

    if (wasAdded) {
      triggerConstraintValidation(constraintType, columnId)
    }
  }

  const removeAllConstraints = (columnId: string) => {
    const updatedColumns = props.data.columns.map((col) => {
      if (col.id === columnId) {
        const { notNull, unique, ...restConstraints } = col.constraints || {}
        return {
          ...col,
          constraints: Object.keys(restConstraints).length > 0 ? restConstraints : undefined,
        }
      }
      return col
    })

    updateNodeData(props.id, {
      ...props.data,
      columns: updatedColumns,
      saveState: 'draft',
      updatedAt: new Date().toISOString(),
    })
  }

  const triggerConstraintValidation = (constraintType: string, columnId: string) => {
    const sourceInfo = getSchemaNodeSourceInfo(
      props.id,
      Array.from(store.nodes),
      Array.from(store.edges)
    )

    if (!sourceInfo || !sourceInfo.sourceFilePath) {
      logger.debug(`ℹ️ SchemaNode ${props.id} 未连接数据源，跳过 ${constraintType} 校验`)
      return
    }

    const column = props.data.columns.find((col: any) => col.id === columnId)
    if (!column) {
      logger.warn(`❌ 未找到列: ${columnId}`)
      return
    }

    dispatchValidation(
      constraintType,
      props.id,
      columnId,
      Array.from(store.nodes),
      Array.from(store.edges),
      (nodeId: string, data: any) => {
        updateNodeData(nodeId, data)
      }
    )
  }

  // ============================================================================
  // 数据类型更新
  // ============================================================================

  const updateColumnType = (columnId: string, newType: DataType) => {
    const updatedColumns = props.data.columns.map((col) =>
      col.id === columnId
        ? {
            ...col,
            dataType: newType,
            expressionType: (newType === 'Expression' ? 'explicit' : 'none') as
              | 'none'
              | 'implicit'
              | 'explicit',
            isBound: newType !== 'Expression' ? false : col.isBound,
          }
        : col
    )

    updateNodeData(props.id, {
      ...props.data,
      columns: updatedColumns,
      saveState: 'draft',
      updatedAt: new Date().toISOString(),
    })
  }

  // ============================================================================
  // Pattern 绑定
  // ============================================================================

  const addConstraintToColumn = (columnId: string, constraintType: string) => {
    store.addConstraintToColumn(props.id, columnId, constraintType as 'notNull' | 'unique')
    emit('constraint-add', columnId, constraintType)
  }

  const bindPatternToColumn = (columnId: string, patternData: Record<string, unknown>) => {
    const updatedColumns = props.data.columns.map((col) =>
      col.id === columnId
        ? {
            ...col,
            dataType: 'Expression' as DataType,
            boundPattern: patternData.patternName || patternData.name,
            patternType: patternData.patternType || 'regex',
            isBound: true,
            expressionType: 'explicit' as 'none' | 'implicit' | 'explicit',
            validationErrors: [],
          }
        : col
    )

    updateNodeData(props.id, {
      ...props.data,
      columns: updatedColumns,
      updatedAt: new Date().toISOString(),
    })

    emit('pattern-bind', columnId, patternData)
  }

  return {
    // 状态
    editingColumn,
    editingColumnName,
    columnInputRefs,

    // 列编辑
    startColumnEdit,
    confirmColumnEdit,
    cancelColumnEdit,
    deleteColumn,
    showColumnError,
    onColumnEnter,
    onColumnTab,

    // 约束管理
    toggleConstraint,
    removeAllConstraints,
    addConstraintToColumn,

    // 数据类型
    updateColumnType,

    // Pattern绑定
    bindPatternToColumn,

    // 工具方法
    setInputRef,
  }
}
