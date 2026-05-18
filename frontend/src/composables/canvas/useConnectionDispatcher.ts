/**
 * @file useConnectionDispatcher.ts
 * @description 连接事件调度器组合式函数
 *
 * 该模块统一处理画布上的连接相关事件（connect、connect-start、connect-end）。
 * 根据节点类型和句柄类型将事件分发到对应的处理器。
 *
 * 功能概述：
 * 1. 连接事件监听 - 监听连接开始、进行中、结束事件
 * 2. 事件分发 - 根据节点类型和句柄类型分发到对应处理器
 * 3. Schema 特殊处理 - 处理 Schema 节点列句柄的特殊逻辑
 * 4. 默认连接 - 其他节点类型使用默认连接逻辑
 *
 * 架构设计：
 * - 画布层（NodeCanvas.vue）：只负责绑定事件
 * - 调度层（useConnectionDispatcher）：负责条件判断和分发
 * - 处理器层（useSchemaNodeDrag 等）：负责具体业务逻辑
 *
 * 支持的节点类型：
 * - schema: Schema 节点的列句柄、添加列句柄等特殊句柄
 * - 其他节点类型: 使用默认连接逻辑
 *
 * 连接事件流程：
 * 1. connect-start: 记录拖拽源信息（节点ID、句柄ID、句柄类型）
 * 2. connect: 验证连接有效性，执行实际连接逻辑
 * 3. connect-end: 清理临时状态
 *
 * 依赖说明：
 * - @vue-flow/core: 提供 Connection、OnConnectStartParams 等类型
 * - composables/nodes/schema/useSchemaNodeDrag: Schema 节点拖拽处理
 * - composables/nodes/useConnections: 通用连接处理
 * - composables/validation/useConnectionValidator: 连接验证器
 *
 * 使用场景：
 * - NodeCanvas 组件的连接事件处理
 * - 跨节点类型的连接逻辑分发
 * - Schema 节点的特殊连接场景
 */

import { logger } from '@/core/utils/logger'
import { shallowRef, type Ref } from 'vue'
import {
  useVueFlow,
  type Connection,
  type Node as VueFlowNode,
  type OnConnectStartParams,
} from '@vue-flow/core'
import { useI18n } from 'vue-i18n'
import { useSchemaNodeDrag } from '@/composables/nodes/schema/useSchemaNodeDrag'
import { useConnections } from '@/composables/nodes/useConnections'
import { useConnectionValidator } from '@/composables/validation/useConnectionValidator'

/**
 * 连接开始参数
 */
interface ConnectStartData {
  nodeId: string
  handleId: string
  handleType: 'source' | 'target'
}

/**
 * 连接结束参数
 */
interface ConnectEndData {
  sourceNodeId: string
  sourceHandleId: string
  sourceNode: VueFlowNode | null
}

/**
 * 连接事件处理结果
 */
interface ConnectionHandlerResult {
  handled: boolean
  message?: string
}

/**
 * 连接调度器返回值
 */
export interface UseConnectionDispatcherReturn {
  /**
   * 连接开始事件数据
   */
  connectStartData: Ref<ConnectStartData | null>

  /**
   * 连接结束事件数据
   */
  connectEndData: Ref<ConnectEndData | null>

  /**
   * 处理连接开始事件
   * 记录拖拽源信息，供连接结束时使用
   *
   * @param params - 连接开始参数
   */
  onConnectStart: (params: OnConnectStartParams) => void

  /**
   * 处理连接事件（完成连接）
   *
   * @param params - 连接参数
   * @returns Promise<ConnectionHandlerResult> - 处理结果
   */
  onConnect: (params: Connection) => Promise<ConnectionHandlerResult>

  /**
   * 处理连接结束事件
   * 根据节点类型和句柄类型分发到对应的处理器
   *
   * @param event - 鼠标或触摸事件
   * @returns ConnectionHandlerResult - 处理结果
   */
  onConnectEnd: (event?: MouseEvent | TouchEvent) => ConnectionHandlerResult

  /**
   * 清除连接状态
   * 重置所有内部状态
   */
  clearConnectionState: () => void
}

/**
 * 连接调度器 Composable
 *
 * @example
 * ```typescript
 * const {
 *   connectStartData,
 *   connectEndData,
 *   onConnectStart,
 *   onConnect,
 *   onConnectEnd,
 *   clearConnectionState
 * } = useConnectionDispatcher();
 * ```
 */
export function useConnectionDispatcher(): UseConnectionDispatcherReturn {
  // VueFlow 实例
  const { findNode } = useVueFlow()
  const { t } = useI18n()

  // 连接开始时的数据
  const connectStartData = shallowRef<ConnectStartData | null>(null)

  // 连接结束时的数据
  const connectEndData = shallowRef<ConnectEndData | null>(null)

  // Schema 节点拖拽处理器
  const { handleColumnHandleDragEnd, handleAddColumnHandleDragEnd } = useSchemaNodeDrag()

  // 核心连接处理器
  const { handleConnectionCompleted } = useConnections()

  // 连接验证器
  const { validateConnection } = useConnectionValidator()

  /**
   * 检查目标元素是否是 VueFlow 的句柄或节点
   *
   * @param event - 鼠标或触摸事件
   * @returns 是否释放在句柄或节点上
   */
  const isReleasedOnHandleOrNode = (event: MouseEvent | TouchEvent): boolean => {
    const targetElement = event.target as Element
    return !!(
      targetElement?.closest('.vue-flow__handle') || targetElement?.closest('.vue-flow__node')
    )
  }

  /**
   * 获取可用的约束类型列表
   *
   * 根据节点类型和句柄类型确定应该调用哪个处理器
   *
   * @param sourceNode - 源节点
   * @param sourceHandleId - 源句柄ID
   * @returns 处理器函数或 null
   */
  const getHandlerForDragEnd = (
    sourceNode: VueFlowNode,
    sourceHandleId: string
  ): ((event: MouseEvent | TouchEvent) => ConnectionHandlerResult) | null => {
    // Schema 节点 - 列句柄拖拽
    if (
      sourceNode.type === 'schema' &&
      sourceHandleId &&
      sourceHandleId.startsWith('source-right-')
    ) {
      return (event: MouseEvent | TouchEvent) => {
        const handled = handleColumnHandleDragEnd(sourceNode, sourceHandleId, event)
        return {
          handled,
          message: handled ? '已处理列句柄拖拽' : '列句柄拖拽处理失败',
        }
      }
    }

    // Schema 节点 - 添加列句柄拖拽
    if (sourceNode.type === 'schema' && sourceHandleId === 'add-column-handle') {
      return (event: MouseEvent | TouchEvent) => {
        const handled = handleAddColumnHandleDragEnd(sourceNode.id, event)
        return {
          handled,
          message: handled ? '已处理添加列拖拽' : '添加列拖拽处理失败',
        }
      }
    }

    // 其他节点类型，暂不处理
    return null
  }

  /**
   * 处理连接开始事件
   *
   * @param params - 连接开始参数
   */
  const onConnectStart = (params: OnConnectStartParams): void => {
    connectStartData.value = {
      nodeId: params.nodeId,
      handleId: params.handleId,
      handleType: params.handleType,
    }

    logger.debug(`[ConnectionDispatcher] 连接开始: ${params.nodeId}/${params.handleId}`)
  }

  /**
   * 处理连接事件
   *
   * @param params - 连接参数
   */
  const onConnect = async (params: Connection): Promise<ConnectionHandlerResult> => {
    const sourceNode = findNode(params.source)
    const targetNode = findNode(params.target)

    if (!sourceNode || !targetNode) {
      logger.warn(
        `[ConnectionDispatcher] 连接失败: 找不到节点 source=${params.source}, target=${params.target}`
      )
      return {
        handled: false,
        message: t('common.error.unknownError'),
      }
    }

    const validationResult = validateConnection(
      sourceNode,
      params.sourceHandle,
      targetNode,
      params.targetHandle
    )

    if (!validationResult.isValid) {
      logger.warn(`[ConnectionDispatcher] 连接验证失败: ${validationResult.message}`)
      return {
        handled: false,
        message: validationResult.message,
      }
    }

    await handleConnectionCompleted(params)

    logger.debug(`[ConnectionDispatcher] 连接完成: ${params.source} → ${params.target}`)

    return {
      handled: true,
      message: t('connectionValidation.connectionSuccess'),
    }
  }

  /**
   * 处理连接结束事件
   *
   * @param event - 鼠标或触摸事件
   */
  const onConnectEnd = (event?: MouseEvent | TouchEvent): ConnectionHandlerResult => {
    // 检查连接开始数据是否存在
    if (!connectStartData.value || !event) {
      return { handled: false, message: '无连接数据' }
    }

    const { nodeId: sourceNodeId, handleId: sourceHandleId } = connectStartData.value
    const sourceNode = findNode(sourceNodeId)

    // 检查源节点是否存在
    if (!sourceNode) {
      clearConnectionState()
      return { handled: false, message: '源节点不存在' }
    }

    // 如果释放在句柄或节点上，由其他处理器处理
    if (isReleasedOnHandleOrNode(event)) {
      clearConnectionState()
      return { handled: false, message: '释放在节点上' }
    }

    // 查找对应的处理器
    const handler = getHandlerForDragEnd(sourceNode, sourceHandleId)

    if (handler) {
      const result = handler(event)
      clearConnectionState()
      return result
    }

    // 没有找到对应的处理器
    clearConnectionState()
    return { handled: false, message: '未找到对应处理器' }
  }

  /**
   * 清除连接状态
   */
  const clearConnectionState = (): void => {
    connectStartData.value = null
    connectEndData.value = null
  }

  return {
    connectStartData,
    connectEndData,
    onConnectStart,
    onConnect,
    onConnectEnd,
    clearConnectionState,
  }
}
