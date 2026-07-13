/**
 * @file useConnections.ts
 * @description 画布连接（边）管理组合式函数（编排层）
 *
 * 负责处理 Vue Flow 画布中所有节点连接事件的 orchestration。
 *
 * 架构（God 拆分批次5 后）：
 * - 本文件：编排入口。handleConnectionCompleted 是瘦骨架（约 100 行），
 *   按家族串联调用 connectionHandlers/ 下的 handler
 * - connectionHandlers/：
 *   - edgeStyleResolver.ts / targetHandleValidator.ts（纯函数，批次4 抽出）
 *   - shortcutHandlers.ts（A1-A4：创建边前的提前返回分支）
 *   - dataSourceHandlers.ts（E1/E2：ManualData ↔ Schema 数据流转）
 *   - schemaSourceHandlers.ts（E5/E6：SourcePreview → Schema）
 *   - foreignKeyHandlers.ts（E7-E9：外键参照连接）
 *   - constraintDispatch.ts（E10：约束核心分发 + 映射表 + 回退）
 *   - regexHandlers.ts（E3/E4/E11-E14：正则连接）
 *   - transformHandlers.ts（E15：Transform 输入连接）
 *
 * 流程：解析节点 → 快捷分支（可能不建边）→ 端口校验 → 解析样式 →
 * 创建边 + 事务 → syncOnConnect → 家族 handler 串联 → commit/rollback。
 */

import { logger } from '@/core/utils/logger'
import { ref } from 'vue'
import type { Connection, OnConnectStartParams } from '@vue-flow/core'
import { useGraphStore } from '@/stores/graphStore'
import { useSchemaConnectionHandler } from './schema/useSchemaConnectionHandler'
import { useRegexConnection } from '@/features/regex/composables'
import { useForeignKeyConnection } from './constraints/useForeignKeyConnection'
import { useConditionalConnection } from './constraints/useConditionalConnection'
import { useConstraintConnection } from './constraints/useConstraintConnection'
import { useJsonSchemaConnectionHandler } from './json/useJsonSchemaConnectionHandler'
import { isConstraintNodeType } from '@/services/constraints/validationRegistry'
import { createConnectionTransaction } from '@/utils/nodes/connectionTransaction'
import { updateEdgeData } from '@/services/canvas/vueFlowApi'
import { resolveEdgeStyle } from './connectionHandlers/edgeStyleResolver'
import { isValidConstraintTargetHandle as isValidConstraintTargetHandlePure } from './connectionHandlers/targetHandleValidator'
import { tryHandleShortcutConnection } from './connectionHandlers/shortcutHandlers'
import { handleDataSourceConnection } from './connectionHandlers/dataSourceHandlers'
import { handleSchemaSourceConnection } from './connectionHandlers/schemaSourceHandlers'
import { handleForeignKeyConnection } from './connectionHandlers/foreignKeyHandlers'
import {
  buildConstraintConnectionHandlers,
  handleConstraintDispatch,
} from './connectionHandlers/constraintDispatch'
import { handleRegexConnection } from './connectionHandlers/regexHandlers'
import { handleTransformConnection } from './connectionHandlers/transformHandlers'
import type { ConnectionContext } from './connectionHandlers/types'

export function useConnections() {
  const store = useGraphStore()

  const dragStartData = ref<OnConnectStartParams | null>(null)

  // 实例化各类连接处理器，用于处理不同节点类型之间的连接逻辑
  // 每个处理器负责特定节点类型的连接验证和数据更新
  const schemaConnection = useSchemaConnectionHandler()
  const regexConnection = useRegexConnection()
  const foreignKeyConnection = useForeignKeyConnection()
  const conditionalConnection = useConditionalConnection()
  const constraintConnection = useConstraintConnection()
  const jsonSchemaHandler = useJsonSchemaConnectionHandler()

  // 构建约束类型 → handler 映射表（kind → 专用 handler）
  const constraintConnectionHandlers = buildConstraintConnectionHandlers({
    constraintConnection,
    conditionalConnection,
    foreignKeyConnection,
  })

  /**
   * Toast 消息提示函数
   * 通过控制台输出消息等级，用于调试和用户反馈
   * @param message - 要显示的消息内容
   * @param type - 消息类型，success=成功，error=错误，info=信息
   */
  const showToastMessage = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    logger.debug(`[${type.toUpperCase()}] ${message}`)
  }

  /**
   * 连接开始事件处理
   * 当用户开始拖拽连接线时触发，记录连接起始点信息
   * @param params - 连接开始参数，包含 source、sourceHandle 等信息
   */
  const onConnectStart = (params: OnConnectStartParams) => {
    // 将连接开始参数存储到 ref 中，供后续连接完成时使用
    dragStartData.value = params
  }

  /**
   * 连接完成事件处理 - 瘦编排入口
   *
   * 流程：
   * 1. 解析源/目标节点（防御性检查）
   * 2. 快捷分支（A1-A4）：patternToolbox/pattern吸附/FK快捷/SourcePreview→FK 拒绝
   *    命中则直接返回（不创建边）
   * 3. 约束端口校验（B1）：非法端口 toast + return
   * 4. 解析边样式（C1，纯函数）+ 创建边 + 开启事务
   * 5. syncOnConnect（重建 parent/children/outputPortConnected）
   * 6. 家族 handler 串联（E1-E15，类型条件互斥，共享 tx）：
   *    dataSource → schemaSource → foreignKey → constraint → regex → transform
   * 7. commit + 边状态置 active；失败 rollback + 删边 + toast
   *
   * @param connection - 连接对象，包含 source、target、sourceHandle、targetHandle
   */
  const handleConnectionCompleted = async (connection: Connection) => {
    // 1. 解析节点
    const { source, target, sourceHandle, targetHandle } = connection
    const sourceNode = store.nodes.find((n) => n.id === source)
    const targetNode = store.nodes.find((n) => n.id === target)
    if (!sourceNode || !targetNode) {
      return
    }

    // 2. 快捷分支（A1-A4）：可能不创建边，命中即 return
    const shortcutResult = await tryHandleShortcutConnection(
      {
        connection,
        sourceNode,
        targetNode,
        sourceHandle,
        targetHandle,
      },
      { store, foreignKeyConnection }
    )
    if (shortcutResult.handled) return

    // 3. 约束端口校验（B1）
    if (
      (sourceNode.type === 'schema' ||
        sourceNode.type === 'jsonSchema' ||
        sourceNode.type === 'manualData' ||
        sourceNode.type === 'transformOutput') &&
      isConstraintNodeType(targetNode.type)
    ) {
      if (!isValidConstraintTargetHandle(targetNode.id, targetNode.type, targetHandle)) {
        showToastMessage('约束连接目标端口不匹配，请连接到正确的输入端口', 'error')
        return
      }
    }

    // 4. 解析边样式 + 创建边 + 开启事务
    const edgeStyle = resolveEdgeStyle({
      sourceNodeId: sourceNode.id,
      sourceType: sourceNode.type,
      targetType: targetNode.type,
      targetNodeId: targetNode.id,
      targetHandle,
    }) as unknown as Record<string, unknown>

    edgeStyle.data = {
      ...(edgeStyle.data as Record<string, unknown>),
      status: 'pending',
      validationStatus: 'idle',
    }
    const edgeId = store.createConnection(
      source,
      target,
      sourceHandle ?? undefined,
      targetHandle ?? undefined,
      edgeStyle
    )

    const tx = createConnectionTransaction({
      nodes: store.nodes,
      updateNodeData: store.updateNodeData,
    })

    // 5-6. 事务内：syncOnConnect + 家族 handler 串联
    try {
      store.syncOnConnect(source, target, tx.patchNodeData.bind(tx))

      // 构造共享上下文（边已创建后注入 tx + edgeId + store + 子 composable）
      const ctx: ConnectionContext = {
        connection,
        sourceNode,
        targetNode,
        sourceHandle,
        targetHandle,
        edgeId,
        tx,
        store,
        schemaConnection,
        regexConnection,
        foreignKeyConnection,
        jsonSchemaHandler,
        constraintConnection,
      }

      // 家族 handler 串联（类型条件天然互斥，共享 tx）
      handleDataSourceConnection(ctx) // E1/E2: manualData ↔ schema
      await handleSchemaSourceConnection(ctx) // E5/E6: sourcePreview → schema
      handleForeignKeyConnection(ctx) // E7/E8/E9: 外键参照
      await handleConstraintDispatch(ctx, constraintConnectionHandlers) // E10: 约束核心分发
      await handleRegexConnection(ctx) // E3/E4/E11-E14: 正则
      handleTransformConnection(ctx) // E15: transform 输入

      // 7. 提交 + 边状态置 active
      tx.commit()
      updateEdgeData(edgeId, { status: 'active' })
    } catch (e) {
      tx.rollback()
      store.deleteConnection(edgeId)
      const errorMsg = e instanceof Error ? e.message : String(e)
      showToastMessage(`连接创建失败，已自动回滚: ${errorMsg}`, 'error')
      logger.error('[handleConnectionCompleted] 连接处理失败:', e)
    }
  }

  // isValidConstraintTargetHandle 已抽出为纯函数（connectionHandlers/targetHandleValidator.ts）
  // 此处别名引用，保持内部调用点不变
  const isValidConstraintTargetHandle = isValidConstraintTargetHandlePure

  return {
    dragStartData,
    onConnectStart,
    handleConnectionCompleted,
    showToastMessage,
    // 导出各个连接处理器的方法，供外部直接调用
    // 通过展开运算符将各子处理器的所有方法合并到返回对象中
    ...schemaConnection,
    ...regexConnection,
    ...foreignKeyConnection,
    ...conditionalConnection,
  }
}
