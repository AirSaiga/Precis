/**
 * @file useJsonSchemaEvents.ts
 * @description JSON Schema 节点事件处理
 *
 * 处理 JSON Schema 节点的全局保存事件：
 * 1. 监听 eventBus 的 'json-schema-node-save' 事件（由 useNodeSaving.handleSave 派发）
 * 2. 调用 store.saveSchemaNode 持久化（该方法已支持 jsonSchema 节点类型）
 * 3. 派发 'json-schema-node-save-complete' 事件通知 useNodeSaving 重置保存状态
 *
 * 镜像 useSchemaEvents.handleNodeSave，仅事件名与节点类型不同。
 */

import { logger } from '@/core/utils/logger'
import { eventBus } from '@/core/eventBus'
import { useI18n } from 'vue-i18n'
import { useGraphStore } from '@/stores/graphStore'
import type { JsonSchemaNodeData } from '../types'
import { useToast } from '@/composables/shared/useToast'

/**
 * JSON Schema 节点事件处理
 *
 * @param _props - 组件属性（占位，与 useSchemaEvents 签名保持一致；实际事件通过 eventBus 转发，不依赖 props）
 * @param _emit - Vue 的 emit 函数（占位）
 * @returns 包含事件处理方法的对象
 */
export function useJsonSchemaEvents(
  _props: { id: string; data: JsonSchemaNodeData },
  _emit?: (event: string, ...args: unknown[]) => void
) {
  const { t } = useI18n()
  const store = useGraphStore()
  const toast = useToast()
  const showError = toast.error

  /**
   * 处理 JSON Schema 节点保存事件
   *
   * 流程：
   * 1. 接收 'json-schema-node-save' 事件（含 nodeId/nodeData）
   * 2. 调用 store.saveSchemaNode（已支持 jsonSchema 类型）
   * 3. 按结果派发 'json-schema-node-save-complete'，由 useNodeSaving 重置 isSaving/saveSuccess/saveError
   *
   * @param data - 保存数据对象，包含 nodeId 和 nodeData
   */
  const handleJsonSchemaNodeSave = async (data: { nodeId: string; nodeData: unknown }) => {
    logger.debug('📥 接收到 json-schema-node-save 事件:', data)

    if (!data) {
      logger.warn('保存事件 data 为空，跳过处理')
      return
    }

    const { nodeId } = data

    if (!nodeId) {
      logger.warn('保存事件缺少 nodeId，跳过处理:', data)
      return
    }

    logger.debug('🔄 开始保存 JSON Schema 节点:', nodeId)

    try {
      // store.saveSchemaNode 内部已支持 schema 与 jsonSchema 两种节点类型
      const result = await store.saveSchemaNode(nodeId)

      if (result === true) {
        logger.debug('✅ JSON Schema 节点保存成功:', nodeId)
        eventBus.emit('json-schema-node-save-complete', {
          nodeId,
          success: true,
        })
      } else if (result === 'cancelled') {
        logger.debug('🚫 JSON Schema 节点保存已取消')
        eventBus.emit('json-schema-node-save-complete', {
          nodeId,
          success: false,
          cancelled: true,
        })
      } else {
        logger.debug('❌ JSON Schema 节点保存失败')
        eventBus.emit('json-schema-node-save-complete', {
          nodeId,
          success: false,
        })
      }
    } catch (error) {
      logger.error('保存 JSON Schema 节点失败:', error)
      showError(
        t('messages.persistence.saveFailed') + ': ' + (error as Error).message,
        t('messages.persistence.saveFailed')
      )
      eventBus.emit('json-schema-node-save-complete', {
        nodeId,
        success: false,
        error: String(error),
      })
    }
  }

  return {
    handleJsonSchemaNodeSave,
  }
}
