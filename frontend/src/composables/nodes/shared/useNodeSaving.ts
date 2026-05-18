/**
 * @file useNodeSaving.ts
 * @description 通用节点保存逻辑
 *
 * 功能概述:
 * - 提供节点保存、关闭、校验、拖拽等通用逻辑
 * - 通过参数注入支持 Schema 节点和 JSON Schema 节点
 *
 * 架构设计:
 * - 抽取 save/close/validate/drag 等公共状态和方法
 * - 差异点通过 NodeSavingOptions 回调参数注入
 *
 * 输入示例:
 *   const { handleSave, handleClose, ... } = useNodeSaving({
 *     nodeId: props.id,
 *     nodeData: props.data,
 *     emit,
 *     eventPrefix: 'schema-node',
 *     shouldConfirmClose: () => props.data.saveState === 'draft',
 *   })
 *
 * 输出示例:
 *   返回 isSaving, saveSuccess, handleSave, handleClose 等状态和方法
 */

import { logger } from '@/core/utils/logger'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVueFlow } from '@vue-flow/core'
import { NodeDeletionManager } from '@/services/managers/nodeDeletionManager'
import { triggerValidationForNode } from '@/services/constraints/orchestration/globalValidation'
import { useGraphStore } from '@/stores/graphStore'

export interface NodeSavingOptions {
  nodeId: string
  nodeData: any
  emit: any
  eventPrefix: string
  shouldConfirmClose?: () => boolean
  onSaveSuccess?: () => void
  onPatternBind?: (columnId: string, patternData: any, columns: any[]) => any[]
  addConstraint?: (columnId: string, type: string) => void
  getTargetColumnId?: () => string | null
  nodeType?: string
  onSaveShortcut?: () => void
}

export function useNodeSaving(options: NodeSavingOptions) {
  const { t } = useI18n()
  const { updateNodeData } = useVueFlow()
  const store = useGraphStore()

  const {
    nodeId,
    nodeData,
    emit,
    eventPrefix,
    shouldConfirmClose,
    onSaveSuccess,
    onPatternBind,
    addConstraint,
    getTargetColumnId,
    nodeType,
    onSaveShortcut,
  } = options

  const saveEventName = `${eventPrefix}-save`
  const saveCompleteEventName = `${eventPrefix}-save-complete`

  /**
   * 是否正在保存
   */
  const isSaving = ref(false)

  /**
   * 保存是否成功
   */
  const saveSuccess = ref(false)

  /**
   * 保存是否失败
   */
  const saveError = ref(false)

  /**
   * 保存按钮是否悬停
   */
  const saveBtnHovered = ref(false)

  /**
   * 关闭按钮是否悬停
   */
  const closeBtnHovered = ref(false)

  /**
   * 节点是否悬停
   */
  const nodeHovered = ref(false)

  /**
   * 是否显示关闭确认弹窗
   */
  const showCloseConfirm = ref(false)

  /**
   * 当前悬停的列ID
   */
  const hoveredColumnId = ref<string | null>(null)

  /**
   * 处理保存函数
   */
  const handleSave = async () => {
    if (isSaving.value) return Promise.resolve()

    isSaving.value = true
    saveError.value = false

    return new Promise<boolean>((resolve) => {
      try {
        const _handleSaveComplete = (event: Event) => {
          const customEvent = event as CustomEvent
          const { nodeId: eventNodeId, success, error, cancelled } = customEvent.detail
          if (eventNodeId === nodeId) {
            const nodeElement = document.querySelector(`[data-node-id="${nodeId}"]`)
            nodeElement?.removeEventListener(saveCompleteEventName, _handleSaveComplete)

            isSaving.value = false

            if (success) {
              saveSuccess.value = true
              onSaveSuccess?.()
              resolve(true)
            } else if (cancelled) {
              // 用户取消保存，不显示错误状态
              resolve(false)
            } else {
              saveError.value = true
              logger.error('保存失败:', error)

              setTimeout(() => {
                saveError.value = false
              }, 3000)
              resolve(false)
            }
          }
        }

        logger.debug(`📤 分发${saveEventName}事件:`, { nodeId, nodeData })

        const saveEvent = new CustomEvent(saveEventName, {
          detail: {
            nodeId,
            nodeData,
          },
          bubbles: true,
          composed: true,
        })

        const nodeElement = document.querySelector(`[data-node-id="${nodeId}"]`)
        if (nodeElement) {
          nodeElement.addEventListener(saveCompleteEventName, _handleSaveComplete)
          nodeElement.dispatchEvent(saveEvent)
        } else {
          isSaving.value = false
          saveError.value = true
          logger.error('保存失败: 找不到节点元素')
          resolve(false)
        }
      } catch (error) {
        isSaving.value = false
        saveError.value = true
        logger.error('保存失败:', error)

        setTimeout(() => {
          saveError.value = false
        }, 3000)
        resolve(false)
      }
    })
  }

  /**
   * 处理保存完成事件
   */
  const handleSaveComplete = (data: { nodeId: string; success: boolean; error?: unknown }) => {
    if (data.nodeId === nodeId) {
      isSaving.value = false

      if (data.success) {
        saveSuccess.value = true
        onSaveSuccess?.()
      } else {
        saveError.value = true
        setTimeout(() => {
          saveError.value = false
        }, 3000)
      }
    }
  }

  /**
   * 处理DOM事件
   */
  const handleSaveCompleteDOM = (event: Event) => {
    handleSaveComplete((event as CustomEvent).detail)
  }

  /**
   * 关闭处理函数
   */
  const handleClose = () => {
    if (shouldConfirmClose ? shouldConfirmClose() : false) {
      showCloseConfirm.value = true
    } else {
      const manager = NodeDeletionManager.getInstance()
      manager.delete(nodeId)
    }
  }

  /**
   * 确认关闭（不保存）
   */
  const confirmCloseWithoutSave = () => {
    showCloseConfirm.value = false
    const manager = NodeDeletionManager.getInstance()
    manager.delete(nodeId)
  }

  /**
   * 保存并关闭
   */
  const saveAndClose = async () => {
    const saveResult = await handleSave()
    if (saveResult) {
      showCloseConfirm.value = false
      const manager = NodeDeletionManager.getInstance()
      manager.delete(nodeId)
    }
  }

  /**
   * 取消关闭
   */
  const cancelClose = () => {
    showCloseConfirm.value = false
  }

  /**
   * 全表校验处理函数
   */
  const handleValidate = () => {
    triggerValidationForNode(nodeId, store.nodes, store.edges, store.updateNodeData)
  }

  /**
   * 处理Pattern拖拽
   */
  const handlePatternDragOver = (event: DragEvent) => {
    event.preventDefault()
    event.dataTransfer!.dropEffect = 'copy'

    const target = event.target as HTMLElement | null
    const row = target?.closest?.('.column-row') as HTMLElement | null
    const columnId = row?.dataset?.columnId
    if (columnId) {
      hoveredColumnId.value = columnId
    }
  }

  /**
   * 处理Pattern放置
   */
  const handlePatternDrop = async (event: DragEvent) => {
    event.preventDefault()
    try {
      const v2Str = event.dataTransfer!.getData('application/x-project-item')
      const jsonStr = event.dataTransfer!.getData('application/json')
      const payloadStr = v2Str || jsonStr
      if (!payloadStr) return

      const droppedData = JSON.parse(payloadStr)
      const targetColumnId =
        (getTargetColumnId ? getTargetColumnId() : hoveredColumnId.value) || nodeData.columns[0]?.id

      if (targetColumnId) {
        if (droppedData.type === 'pattern' && droppedData.source === 'projectResources') {
          const patternId = String(droppedData?.meta?.id || '')
          if (!patternId) return

          const foundNode = nodeType
            ? store.nodes.find((n: any) => n.id === nodeId && n.type === nodeType)
            : store.nodes.find((n: any) => n.id === nodeId)
          const idx = (nodeData.columns || []).findIndex((c: any) => c.id === targetColumnId)
          const basePos = foundNode
            ? {
                x: foundNode.position.x + 420,
                y: foundNode.position.y + Math.max(0, idx) * 90,
              }
            : { x: 420, y: 0 }

          const regexNodeId = await store.importV2ResourceToCanvas('pattern', patternId, basePos, {
            includeDeps: false,
            moveIfExists: true,
          })
          if (!regexNodeId) return
          store.bindRegexToSchemaColumn(nodeId, targetColumnId, regexNodeId)
          emit('pattern-bind', targetColumnId, { id: patternId, kind: 'pattern' })
          return
        }

        if (droppedData.type === 'pattern') {
          bindPatternToColumn(targetColumnId, droppedData)
        } else if (droppedData.type === 'constraint') {
          addConstraintToColumn(targetColumnId, droppedData.constraintType)
        }
      }
    } catch (error) {
      logger.error('拖拽操作失败:', error)
    }
  }

  /**
   * 绑定Pattern到列
   */
  const bindPatternToColumn = (columnId: string, patternData: Record<string, unknown>) => {
    let updatedColumns = nodeData.columns.map((col: any) =>
      col.id === columnId
        ? {
            ...col,
            boundPattern: patternData.patternName || patternData.name,
            boundRegistry: patternData.registry || 'expression_registry',
            patternType: patternData.patternType || 'regex',
            isBound: true,
            expressionType: 'explicit' as const,
            validationErrors: [],
          }
        : col
    )

    if (onPatternBind) {
      updatedColumns = onPatternBind(columnId, patternData, updatedColumns)
    }

    updateNodeData(nodeId, {
      ...nodeData,
      columns: updatedColumns,
      updatedAt: new Date().toISOString(),
    })

    emit('pattern-bind', columnId, patternData)
  }

  /**
   * 添加约束到列
   */
  const addConstraintToColumn = (columnId: string, constraintType: string) => {
    if (addConstraint) {
      addConstraint(columnId, constraintType)
    }
    emit('constraint-add', columnId, constraintType)
  }

  /**
   * 处理键盘事件
   */
  const handleKeydown = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 's') {
      event.preventDefault()
      if (onSaveShortcut) {
        onSaveShortcut()
      } else {
        emit('save', nodeData)
      }
    }
  }

  return {
    // 保存状态
    isSaving,
    saveSuccess,
    saveError,
    saveBtnHovered,
    closeBtnHovered,
    nodeHovered,
    showCloseConfirm,
    hoveredColumnId,

    // 保存方法
    handleSave,
    handleSaveComplete,
    handleSaveCompleteDOM,

    // 关闭方法
    handleClose,
    confirmCloseWithoutSave,
    saveAndClose,
    cancelClose,

    // 校验方法
    handleValidate,

    // 事件处理
    handlePatternDragOver,
    handlePatternDrop,
    handleKeydown,

    // 辅助方法
    bindPatternToColumn,
    addConstraintToColumn,
  }
}
