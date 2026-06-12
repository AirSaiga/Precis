/**
 * @file useJsonSchemaInteractions.ts
 * @description JSON Schema 节点交互逻辑
 *
 * 功能概述:
 * - 列连接吸附动画效果
 * - 边变化监听与处理
 * - 约束节点连接处理
 * - 键盘事件导航
 * - 列名编辑状态管理
 * - 输入引用管理
 *
 * 架构设计:
 * - 采用组合式函数模式，与 Vue 组件解耦
 * - 使用 Pinia Graph Store 进行状态管理
 * - 通过 VueFlow 的 useVueFlow 获取节点操作能力
 * - 参考 useSchemaInteractions 实现，保持接口一致性
 *
 * 依赖说明:
 * - @vue-flow/core: VueFlow 核心能力
 * - stores/graphStore: 图谱状态管理
 * - types/nodes: JsonSchemaNodeData, JsonSchemaColumn 类型
 */

import { ref, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGraphStore } from '@/stores/graphStore'
import type { JsonSchemaNodeData, JsonSchemaColumn } from '@/types/nodes'
import { useNodeColumnEditing } from '../shared/useNodeColumnEditing'

export interface JsonSchemaInteractionsProps {
  id: string
  data: JsonSchemaNodeData
}

export interface JsonSchemaInteractionsEmit {
  (e: 'constraint-create', data: ConstraintCreateData): void
  (e: 'column-update', data: { columnId: string; updates: Partial<JsonSchemaColumn> }): void
  (e: 'column-delete', columnId: string): void
  (e: 'source-connect', data: { sourceNodeId: string; targetNodeId: string }): void
}

export interface ConstraintCreateData {
  type?: string
  columnId?: string
  constraintType?: string
  targetNodeId?: string
  sourceColumn?: string
  targetColumn?: string
  targetColumnId?: string
  constraintName?: string
  relationType?: string
}

export function useJsonSchemaInteractions(
  props: JsonSchemaInteractionsProps,
  emit: JsonSchemaInteractionsEmit
) {
  const { t } = useI18n()
  const store = useGraphStore()

  const snappingColumnIds = ref<Set<string>>(new Set())
  const knownEdgeIds = ref<Set<string>>(new Set())

  // ============================================================================
  // 列编辑通用逻辑
  // ============================================================================

  const genericEditing = useNodeColumnEditing<JsonSchemaColumn>(props, emit, {
    findColumn: (id) => props.data.columns.find((c) => c.id === id),
    createColumn: (partial) =>
      ({
        id: partial.id || crypto.randomUUID(),
        columnName: partial.columnName || `field_${props.data.columns.length + 1}`,
        jsonPath: partial.jsonPath || `$.field_${props.data.columns.length + 1}`,
        dataType: (partial.dataType as JsonSchemaColumn['dataType']) || 'string',
        nullable: partial.nullable ?? true,
        primaryKey: partial.primaryKey ?? false,
        description: partial.description,
        children: partial.children,
        isExpanded: true,
      }) as JsonSchemaColumn,
    supportsNested: true,
    updateColumns: (columns) => {
      store.updateNodeData(props.id, {
        ...props.data,
        columns,
        saveState: 'draft',
        updatedAt: new Date().toISOString(),
      })
    },
    onConfirmColumnEdit: (columnId, newName) => {
      emit('column-update', { columnId, updates: { columnName: newName } })
    },
  })

  // 映射通用状态到 JSON 命名（保持返回接口兼容）
  const editingColumnName = genericEditing.editingColumnId
  const columnInputRefs = genericEditing.columnInputRefs

  const setInputRef = (columnId: string, el: HTMLInputElement | null) => {
    genericEditing.setInputRef(el, columnId)
  }

  const startColumnEdit = genericEditing.startColumnEdit
  const confirmColumnEdit = genericEditing.confirmColumnEdit
  const cancelColumnEdit = genericEditing.cancelColumnEdit
  const onColumnEnter = genericEditing.onColumnEnter
  const onColumnTab = genericEditing.onColumnTab
  const handleKeydown = genericEditing.handleKeydown
  const updateColumnDataType = genericEditing.updateColumnDataType
  const addColumn = genericEditing.addColumn

  const constraintNodeTypeMap: Record<string, string> = {
    notNullConstraint: 'notNull',
    uniqueConstraint: 'unique',
    allowedValuesConstraint: 'allowedValues',
    foreignKeyConstraint: 'foreignKey',
    conditionalConstraint: 'conditional',
    scriptedConstraint: 'scripted',
    charsetConstraint: 'charset',
    dateLogicConstraint: 'dateLogic',
  }

  /**
   * 触发某一列的右端点吸附动画
   * 当列连接到约束节点时，触发视觉反馈动画
   *
   * @param columnId - JSON Schema 列 ID
   *
   * @example
   * ```typescript
   * triggerColumnSnapAnimation('col-123');
   * // 420ms 后自动移除动画类
   * ```
   */
  const triggerColumnSnapAnimation = (columnId: string) => {
    const next = new Set(snappingColumnIds.value)
    next.add(columnId)
    snappingColumnIds.value = next

    window.setTimeout(() => {
      const after = new Set(snappingColumnIds.value)
      after.delete(columnId)
      snappingColumnIds.value = after
    }, 420)
  }

  /**
   * 监听新增连接并触发吸附动画
   * 监视 Graph Store 中边列表的变化，检测新增连接
   */
  const watchConnectionChanges = () => {
    watch(
      () => store.edges.map((e) => e.id),
      (newEdgeIdList) => {
        const currentKnown = knownEdgeIds.value
        const newEdges = store.edges.filter((e) => !currentKnown.has(e.id))

        for (const edge of newEdges) {
          if (edge.source !== props.id) continue
          if (!edge.sourceHandle || !edge.sourceHandle.startsWith('source-right-')) continue

          const targetNode = store.nodes.find((n) => n.id === edge.target)
          const isInstantConstraint =
            targetNode?.type === 'uniqueConstraint' ||
            targetNode?.type === 'notNullConstraint' ||
            targetNode?.type === 'allowedValuesConstraint'

          if (!isInstantConstraint) continue

          const columnId = edge.sourceHandle.replace('source-right-', '')
          triggerColumnSnapAnimation(columnId)
        }

        knownEdgeIds.value = new Set(newEdgeIdList)
      },
      { deep: false }
    )
  }

  /**
   * 初始化已知边集合
   * 在组件挂载时调用，用于记录当前已有的边
   * 避免后续检测边变化时重复处理已存在的边
   */
  const initKnownEdgeIds = () => {
    knownEdgeIds.value = new Set(store.edges.map((e) => e.id))
  }

  /**
   * 处理列输出连接事件
   * 当列的右端点连接到约束节点时触发
   *
   * @param event - 连接事件对象
   * @param event.handleId - 连接点 ID，格式为 'source-right-{columnId}'
   * @param event.targetNodeId - 目标节点 ID
   * @param event.targetHandleId - 目标连接点 ID
   *
   * @example
   * ```typescript
   * handleColumnOutputConnect({
   *   handleId: 'source-right-col-123',
   *   targetNodeId: 'constraint-456',
   *   targetHandleId: 'target-left'
   * });
   * ```
   */
  const handleColumnOutputConnect = (event: {
    handleId: string
    targetNodeId: string
    targetHandleId: string
  }) => {
    const { handleId, targetNodeId } = event
    const columnId = handleId.replace('source-right-', '')
    const targetNode = store.nodes.find((n) => n.id === targetNodeId)

    if (targetNode && targetNode.type !== 'schema' && targetNode.type !== 'jsonSchema') {
      const constraintType = targetNode.type ? constraintNodeTypeMap[targetNode.type] : undefined
      if (constraintType) {
        const updatedColumns = props.data.columns.map((col) => {
          if (col.id === columnId) {
            const currentConstraints = col.constraints || {}
            return {
              ...col,
              constraints: { ...currentConstraints, [constraintType]: true },
            }
          }
          return col
        })
        store.updateNodeData(props.id, {
          ...props.data,
          columns: updatedColumns,
          saveState: 'draft',
          updatedAt: new Date().toISOString(),
        })
        emit('constraint-create', { columnId, constraintType, targetNodeId })
      }
    }
  }

  /**
   * 创建表关系（外键约束）
   * 当从列拖拽到目标表的列时创建关系
   *
   * @param columnId - 源列 ID
   * @param targetNodeId - 目标节点 ID
   * @param targetColumnId - 目标列 ID（可选）
   *
   * @example
   * ```typescript
   * createTableRelation('col-user-id', 'users-schema', 'col-id');
   * ```
   */
  const createTableRelation = (columnId: string, targetNodeId: string, targetColumnId?: string) => {
    const sourceColumn = props.data.columns.find((col) => col.id === columnId)
    if (sourceColumn) {
      const relationData = {
        type: 'foreign_key',
        sourceColumn: sourceColumn.columnName,
        targetColumn: targetNodeId,
        targetColumnId: targetColumnId,
        constraintName: `FK_${props.data.tableName}_${sourceColumn.columnName}`,
        relationType: 'many_to_one',
      }
      emit('constraint-create', relationData)
      const updatedColumns = props.data.columns.map((col) =>
        col.id === columnId ? { ...col, relation: relationData, isForeignKey: true } : col
      )
      store.updateNodeData(props.id, {
        ...props.data,
        columns: updatedColumns,
        saveState: 'draft',
        updatedAt: new Date().toISOString(),
      })
    }
  }

  /**
   * 获取列的吸附状态
   * 用于模板中判断是否添加动画类
   *
   * @param columnId - 列 ID
   * @returns 是否处于吸附动画状态
   */
  const isColumnSnapping = (columnId: string): boolean => {
    return snappingColumnIds.value.has(columnId)
  }

  /**
   * 获取列是否正在编辑
   *
   * @param columnId - 列 ID
   * @returns 是否处于编辑状态
   */
  const isColumnEditing = (columnId: string): boolean => {
    return editingColumnName.value === columnId
  }

  /**
   * 获取指定列的当前列名
   * 如果正在编辑该列，返回空字符串（由输入框处理）
   *
   * @param columnId - 列 ID
   * @returns 列名
   */
  const getColumnName = (columnId: string): string => {
    if (editingColumnName.value === columnId) {
      return ''
    }
    const column = props.data.columns.find((col) => col.id === columnId)
    return column?.columnName || ''
  }

  /**
   * 更新列的 JSONPath
   *
   * @param columnId - 列 ID
   * @param jsonPath - 新的 JSONPath
   */
  const updateColumnJsonPath = (columnId: string, jsonPath: string) => {
    const updatedColumns = props.data.columns.map((col) =>
      col.id === columnId ? { ...col, jsonPath } : col
    )
    store.updateNodeData(props.id, {
      ...props.data,
      columns: updatedColumns,
      saveState: 'draft',
      updatedAt: new Date().toISOString(),
    })
  }

  /**
   * 更新列的约束状态
   *
   * @param columnId - 列 ID
   * @param constraintType - 约束类型
   * @param enabled - 是否启用
   */
  const updateColumnConstraint = (
    columnId: string,
    constraintType: 'notNull' | 'unique' | 'allowedValues',
    enabled: boolean
  ) => {
    const updatedColumns = props.data.columns.map((col) => {
      if (col.id === columnId) {
        const currentConstraints = col.constraints || {}
        return {
          ...col,
          constraints: {
            ...currentConstraints,
            [constraintType]: enabled ? true : undefined,
          },
        }
      }
      return col
    })
    store.updateNodeData(props.id, {
      ...props.data,
      columns: updatedColumns,
      saveState: 'draft',
      updatedAt: new Date().toISOString(),
    })
  }

  /**
   * 删除列
   * 支持嵌套子列删除
   *
   * @param columnId - 要删除的列 ID
   * @param parentId - 父列 ID（可选，用于树形结构）
   */
  const deleteColumn = (columnId: string, parentId?: string) => {
    if (parentId) {
      const updatedColumns = props.data.columns.map((col) => {
        if (col.id === parentId) {
          return {
            ...col,
            children: (col.children || []).filter((c) => c.id !== columnId),
          }
        }
        return col
      })
      store.updateNodeData(props.id, {
        ...props.data,
        columns: updatedColumns,
        saveState: 'draft',
        updatedAt: new Date().toISOString(),
      })
    } else {
      store.updateNodeData(props.id, {
        ...props.data,
        columns: props.data.columns.filter((col) => col.id !== columnId),
        saveState: 'draft',
        updatedAt: new Date().toISOString(),
      })
    }
    emit('column-delete', columnId)
  }

  /**
   * 处理数据源连接
   * 当节点接收到来自 JsonSourcePreview 节点的连接时调用
   *
   * @param sourceNodeId - 源节点 ID
   */
  const handleSourceConnect = (sourceNodeId: string) => {
    const sourceNode = store.nodes.find((n) => n.id === sourceNodeId)
    if (sourceNode && sourceNode.type === 'jsonSourcePreview') {
      store.updateNodeData(props.id, {
        ...props.data,
        sourceNodeId: sourceNodeId,
        saveState: 'draft',
        updatedAt: new Date().toISOString(),
      })
      emit('source-connect', {
        sourceNodeId,
        targetNodeId: props.id,
      })
    }
  }

  /**
   * 监听数据源连接
   * 检测从 JsonSourcePreview 到当前节点的连接
   */
  const watchSourceConnection = () => {
    watch(
      () => store.edges,
      (edges) => {
        const sourceEdge = edges.find(
          (edge) => edge.target === props.id && edge.targetHandle === 'target-left'
        )
        if (sourceEdge) {
          handleSourceConnect(sourceEdge.source)
        } else if (props.data.sourceNodeId) {
          store.updateNodeData(props.id, {
            ...props.data,
            sourceNodeId: undefined,
            sourceFile: undefined,
            sourceFilePath: undefined,
            sourceType: undefined,
            sourceMode: undefined,
            localPath: undefined,
            jsonPath: undefined,
            recordPath: undefined,
            saveState: 'draft',
            updatedAt: new Date().toISOString(),
          })
        }
      },
      { deep: true }
    )
  }

  /**
   * 处理 Pattern 节点拖拽到列上
   *
   * @param columnId - 目标列 ID
   * @param patternData - 拖拽的 Pattern 数据
   */
  const handlePatternDrop = (
    columnId: string,
    patternData: { pattern: string; patternName?: string }
  ) => {
    const updatedColumns = props.data.columns.map((col) => {
      if (col.id === columnId) {
        return {
          ...col,
          boundPattern: patternData.pattern,
          isBound: true,
          bindingConfig: {
            sourcePattern: patternData.patternName,
            status: 'active' as const,
          },
        }
      }
      return col
    })
    store.updateNodeData(props.id, {
      ...props.data,
      columns: updatedColumns,
      saveState: 'draft',
      updatedAt: new Date().toISOString(),
    })
  }

  /**
   * 清理资源
   * 在组件卸载时清理副作用
   */
  const cleanup = () => {
    snappingColumnIds.value.clear()
    knownEdgeIds.value.clear()
    columnInputRefs.value = {}
    genericEditing.cancelColumnEdit()
  }

  return {
    snappingColumnIds,
    triggerColumnSnapAnimation,
    watchConnectionChanges,
    initKnownEdgeIds,
    handleColumnOutputConnect,
    createTableRelation,
    handleKeydown,
    onColumnEnter,
    onColumnTab,
    editingColumnName,
    startColumnEdit,
    confirmColumnEdit,
    cancelColumnEdit,
    columnInputRefs,
    setInputRef,
    isColumnSnapping,
    isColumnEditing,
    getColumnName,
    updateColumnJsonPath,
    updateColumnDataType,
    updateColumnConstraint,
    addColumn,
    deleteColumn,
    handleSourceConnect,
    watchSourceConnection,
    handlePatternDrop,
    cleanup,
    constraintNodeTypeMap,
  }
}
