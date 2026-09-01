/**
 * @file useSchemaEvents.ts
 * @description Schema节点事件处理
 * 处理 Schema 节点相关的全局事件，包括保存、表头变更等
 * 提供事件监听和自定义事件派发功能
 */

import { logger } from '@/core/utils/logger'
import { eventBus } from '@/core/eventBus'
import { useI18n } from 'vue-i18n'
import { useGraphStore } from '@/stores/graphStore'
import type { SchemaNodeData } from '../types'
import { useToast } from '@/composables/shared/useToast'

/**
 * Schema节点事件处理
 * 管理 Schema 节点的事件监听和处理逻辑
 * 包括节点保存、表头变更等事件的处理
 *
 * @param props - 组件属性，包含节点 ID 和数据
 * @param emit - Vue 的 emit 函数，用于向上层组件通知事件
 * @returns 包含事件处理方法的对象
 */
export function useSchemaEvents(
  props: { id: string; data: SchemaNodeData },
  emit: (event: string, ...args: unknown[]) => void
) {
  // 国际化支持
  const { t } = useI18n()
  // 获取全局图存储，用于访问和修改节点数据
  const store = useGraphStore()
  // 统一 Toast 消息工具
  const toast = useToast()
  const showError = toast.error

  // 处理节点保存事件
  // 当用户触发 Schema 节点保存时调用
  // 验证参数有效性，调用 store 保存节点数据
  // 保存完成后派发自定义事件通知完成状态
  //
  // @param data - 保存数据对象，包含 nodeId 和 nodeData
  const handleNodeSave = async (data: { nodeId: string; nodeData: unknown }) => {
    // 记录接收到保存事件的日志
    logger.debug('📥 接收到schema-node-save事件:', data)

    // 验证 data 是否存在
    if (!data) {
      logger.warn('保存事件data为空，跳过处理')
      return
    }

    // 解构获取节点 ID 和节点数据
    const { nodeId, nodeData } = data

    // 验证必要参数是否存在
    if (!nodeId || !nodeData) {
      logger.warn('保存事件缺少必要参数，跳过处理:', data)
      return
    }

    // 记录开始保存的日志
    logger.debug('🔄 开始保存Schema节点:', nodeId)

    try {
      // 调用 store 方法保存 Schema 节点
      const result = await store.saveSchemaNode(nodeId)

      if (result === true) {
        // 记录保存成功的日志
        logger.debug('✅ Schema节点保存成功:', result)

        // 显示成功提示
        // 注意：store.saveSchemaNode 内部已经显示了 toastSuccess，这里可能不需要重复显示
        // showToastMessage('Schema节点保存成功', 'success');

        // 查找对应的 DOM 元素，派发保存完成事件
        eventBus.emit('schema-node-save-complete', {
          nodeId: nodeId,
          success: true,
        })
      } else if (result === 'cancelled') {
        // 保存被取消
        logger.debug('🚫 Schema节点保存已取消')

        eventBus.emit('schema-node-save-complete', {
          nodeId: nodeId,
          success: false,
          cancelled: true,
        })
      } else {
        // 保存失败（store 内部已处理错误提示）
        logger.debug('❌ Schema节点保存失败')

        // 查找对应的 DOM 元素，派发保存完成事件（success: false）
        eventBus.emit('schema-node-save-complete', {
          nodeId: nodeId,
          success: false,
        })
      }
    } catch (error) {
      // 捕获并记录错误
      logger.error('保存Schema节点失败:', error)

      // 显示失败提示
      showError(
        t('messages.persistence.saveFailed') + ': ' + (error as Error).message,
        t('messages.persistence.saveFailed')
      )

      // 查找对应的 DOM 元素，派发保存失败事件
      eventBus.emit('schema-node-save-complete', {
        nodeId: nodeId,
        success: false,
        error: String(error),
      })
    }
  }

  // 返回组合式函数提供的所有方法
  return {
    handleNodeSave,
  }
}
