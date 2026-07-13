/**
 * @file types.ts
 * @description 连接处理家族 handler 的共享上下文类型
 *
 * 定义 handleConnectionCompleted 拆分后各家族 handler 接收的统一上下文。
 * 设计要点：
 * - ConnectionContext（事务内）：节点 + handle + 边ID + 事务 + store + 子 composable
 * - 家族 handler 通过 ctx 访问共享事务和画布状态，无需各自 import store
 *
 * handler 契约约定：成功 resolve、失败 reject（抛错）。
 * 抛出的错误由外层 handleConnectionCompleted 的 try/catch 捕获，触发 tx.rollback()
 * 并删除已创建的边。禁止 handler 内部吞错。
 */

import type { Connection } from '@vue-flow/core'
import type { CustomNode } from '@/types/graph'
import type { useGraphStore } from '@/stores/graphStore'
import type { ConnectionTransaction } from '@/utils/nodes/connectionTransaction'
import type { useSchemaConnectionHandler } from '../schema/useSchemaConnectionHandler'
import type { useRegexConnection } from '@/features/regex/composables'
import type { useForeignKeyConnection } from '../constraints/useForeignKeyConnection'
import type { useJsonSchemaConnectionHandler } from '../json/useJsonSchemaConnectionHandler'
import type { useConstraintConnection } from '../constraints/useConstraintConnection'

/** 基础连接上下文（创建边之前即可用，快捷分支使用） */
export interface BaseConnectionContext {
  /** 原始 Vue Flow 连接对象 */
  connection: Connection
  /** 解析后的源节点 */
  sourceNode: CustomNode
  /** 解析后的目标节点 */
  targetNode: CustomNode
  /** 源 handle ID（可能为 null） */
  sourceHandle: string | null | undefined
  /** 目标 handle ID（可能为 null） */
  targetHandle: string | null | undefined
}

/** 事务内连接上下文（边已创建后注入，E 家族 handler 使用） */
export interface ConnectionContext extends BaseConnectionContext {
  /** 已创建的边 ID */
  edgeId: string
  /** 共享事务（patchNodeData 暂存修改，commit/rollback 控制原子性） */
  tx: ConnectionTransaction
  /** 画布 store（访问 nodes 数组、updateNodeData 等） */
  store: ReturnType<typeof useGraphStore>
  /** 子 composable 处理器（按家族注入） */
  schemaConnection: ReturnType<typeof useSchemaConnectionHandler>
  regexConnection: ReturnType<typeof useRegexConnection>
  foreignKeyConnection: ReturnType<typeof useForeignKeyConnection>
  jsonSchemaHandler: ReturnType<typeof useJsonSchemaConnectionHandler>
  constraintConnection: ReturnType<typeof useConstraintConnection>
}

/**
 * 家族 handler 统一契约
 *
 * @throws 连接处理失败时抛错，由外层捕获触发 rollback
 */
export type FamilyHandler = (ctx: ConnectionContext) => Promise<void> | void
