/**
 * @file useNodeColumnEditing.ts
 * @description 节点列编辑通用逻辑
 *
 * 功能概述:
 * - 提供 Schema / JsonSchema 节点列名编辑、数据类型更新、添加/删除列的公共逻辑
 * - 支持键盘导航（Enter 确认、Tab 切换、Esc 取消）
 * - 通过选项注入差异行为（列查找、列创建、嵌套支持等）
 *
 * 架构设计:
 * - 管理 editingColumnId / editingColumnText / columnInputRefs 编辑状态
 * - 各具体节点类型组合式函数调用本通用逻辑后按需扩展特有功能
 *
 * 输入示例:
 * ```ts
 * const editing = useNodeColumnEditing(props, emit, {
 *   findColumn: (id) => props.data.columns.find((c) => c.id === id),
 *   createColumn: (partial) => ({ id: crypto.randomUUID(), columnName: 'new_col', ...partial }),
 *   supportsNested: false,
 *   updateColumns: (columns) => updateNodeData(props.id, { ...props.data, columns }),
 * })
 * ```
 *
 * 输出示例:
 * ```ts
 * {
 *   editingColumnId,
 *   editingColumnText,
 *   columnInputRefs,
 *   setInputRef,
 *   startColumnEdit,
 *   confirmColumnEdit,
 *   cancelColumnEdit,
 *   onColumnEnter,
 *   onColumnTab,
 *   handleKeydown,
 *   updateColumnDataType,
 *   deleteColumn,
 *   addColumn,
 * }
 * ```
 */

import { logger } from '@/core/utils/logger'
import { ref, nextTick } from 'vue'

export interface UseNodeColumnEditingOptions<TColumn extends { id: string; columnName: string }> {
  /** 查找列 */
  findColumn: (id: string) => TColumn | undefined
  /** 创建新列 */
  createColumn: (partial: Partial<TColumn>) => TColumn
  /** 是否支持嵌套子列 */
  supportsNested: boolean
  /** 更新列数组（由调用方负责持久化） */
  updateColumns: (columns: TColumn[]) => void
  /** 确认编辑前的校验回调：返回错误消息则阻断，返回 undefined 则通过 */
  validateColumnName?: (columnId: string, newName: string) => string | undefined
  /** 空名称时生成默认名称 */
  generateDefaultName?: (columnId: string, columns: TColumn[]) => string
  /** 确认编辑后的回调 */
  onConfirmColumnEdit?: (columnId: string, newName: string) => void
  /** 删除列前的确认回调：返回 false 则取消删除 */
  beforeDeleteColumn?: (columnId: string) => boolean | Promise<boolean>
  /** 删除列后的回调 */
  onDeleteColumn?: (columnId: string) => void
  /** Tab 键是否导航到下一列（默认 true） */
  tabNavigates?: boolean
}

export function useNodeColumnEditing<TColumn extends { id: string; columnName: string }>(
  props: { id: string; data: { columns: TColumn[] } },
  _emit: unknown,
  options: UseNodeColumnEditingOptions<TColumn>
) {
  // ============================================================================
  // 编辑状态
  // ============================================================================

  const editingColumnId = ref<string | null>(null)
  const editingColumnText = ref('')
  const columnInputRefs = ref<Record<string, HTMLInputElement | undefined>>({})

  // ============================================================================
  // 输入框引用管理
  // ============================================================================

  const setInputRef = (el: unknown, id: string) => {
    if (el) {
      columnInputRefs.value[id] = el as HTMLInputElement
    }
  }

  // ============================================================================
  // 列编辑基础操作
  // ============================================================================

  const startColumnEdit = (id: string) => {
    const col = options.findColumn(id)
    if (!col) return
    editingColumnId.value = id
    editingColumnText.value = col.columnName
    nextTick(() => {
      const inputEl = columnInputRefs.value[id]
      if (inputEl) {
        inputEl.focus()
        inputEl.select()
      }
    })
  }

  const confirmColumnEdit = (columnId: string, newName?: string) => {
    const col = options.findColumn(columnId)
    if (!col) {
      editingColumnId.value = null
      editingColumnText.value = ''
      return
    }

    let finalName = (newName !== undefined ? newName : editingColumnText.value).trim()

    if (!finalName && options.generateDefaultName) {
      finalName = options.generateDefaultName(columnId, props.data.columns)
    }

    if (finalName === col.columnName) {
      editingColumnId.value = null
      editingColumnText.value = ''
      return
    }

    if (options.validateColumnName) {
      const error = options.validateColumnName(columnId, finalName)
      if (error) {
        logger.warn(`列名校验失败 [${columnId}]: ${error}`)
        return
      }
    }

    const updatedColumns = props.data.columns.map((c) =>
      c.id === columnId ? { ...c, columnName: finalName } : c
    )

    options.updateColumns(updatedColumns)
    options.onConfirmColumnEdit?.(columnId, finalName)

    editingColumnId.value = null
    editingColumnText.value = ''
  }

  const cancelColumnEdit = () => {
    editingColumnId.value = null
    editingColumnText.value = ''
  }

  // ============================================================================
  // 键盘导航
  // ============================================================================

  const onColumnEnter = (columnId: string) => {
    if (editingColumnId.value) {
      confirmColumnEdit(editingColumnId.value, editingColumnText.value)
    } else {
      startColumnEdit(columnId)
    }
  }

  const onColumnTab = (columnId: string) => {
    if (editingColumnId.value) {
      confirmColumnEdit(editingColumnId.value, editingColumnText.value)
    }
    if (options.tabNavigates !== false) {
      const idx = props.data.columns.findIndex((c) => c.id === columnId)
      const next = props.data.columns[idx + 1]
      if (next) {
        startColumnEdit(next.id)
        nextTick(() => {
          const inputEl = columnInputRefs.value[next.id]
          if (inputEl) {
            inputEl.focus()
            inputEl.select()
          }
        })
      }
    }
  }

  const handleKeydown = (event: KeyboardEvent) => {
    switch (event.key) {
      case 'Enter':
        if (editingColumnId.value) {
          confirmColumnEdit(editingColumnId.value, (event.target as HTMLInputElement).value)
        } else {
          onColumnEnter((event.target as HTMLElement).dataset.columnId || '')
        }
        break
      case 'Tab':
        event.preventDefault()
        onColumnTab((event.target as HTMLElement).dataset.columnId || '')
        break
      case 'Escape':
        cancelColumnEdit()
        break
    }
  }

  // ============================================================================
  // 列数据类型更新
  // ============================================================================

  const updateColumnDataType = (columnId: string, dataType: string) => {
    const updatedColumns = props.data.columns.map((c) =>
      c.id === columnId ? { ...c, dataType } : c
    )
    options.updateColumns(updatedColumns)
  }

  // ============================================================================
  // 删除列
  // ============================================================================

  const deleteColumn = async (columnId: string) => {
    if (options.beforeDeleteColumn) {
      const shouldProceed = await options.beforeDeleteColumn(columnId)
      if (!shouldProceed) return
    }

    const updatedColumns = props.data.columns.filter((c) => c.id !== columnId)
    options.updateColumns(updatedColumns)

    if (columnInputRefs.value[columnId]) {
      delete columnInputRefs.value[columnId]
    }

    options.onDeleteColumn?.(columnId)
  }

  // ============================================================================
  // 添加列
  // ============================================================================

  const addColumn = (parentId: string | null, partial: Partial<TColumn>) => {
    const newColumn = options.createColumn(partial)

    if (parentId && options.supportsNested) {
      const updatedColumns = props.data.columns.map((col) => {
        if (col.id === parentId) {
          return {
            ...col,
            children: [...((col as unknown as { children?: TColumn[] }).children || []), newColumn],
          }
        }
        return col
      })
      options.updateColumns(updatedColumns)
    } else {
      options.updateColumns([...props.data.columns, newColumn])
    }
  }

  return {
    editingColumnId,
    editingColumnText,
    columnInputRefs,
    setInputRef,
    startColumnEdit,
    confirmColumnEdit,
    cancelColumnEdit,
    onColumnEnter,
    onColumnTab,
    handleKeydown,
    updateColumnDataType,
    deleteColumn,
    addColumn,
  }
}
