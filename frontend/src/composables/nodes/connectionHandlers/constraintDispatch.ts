/**
 * @file constraintDispatch.ts
 * @description 约束连接核心分发（E10）
 *
 * 处理 (schema|jsonSchema|transformOutput|manualData) → constraint 的连接：
 * 1. 按 constraintKind 查 constraintConnectionHandlers 映射表，命中则调专用 handler
 * 2. 无专用 handler 时，若是纯数据源（transformOutput/manualData）走回退：
 *    设置基本引用数据 + 触发 validateForInlineSource 行内校验（异步不 await）
 *
 * 包含迁移自 useConnections 的：
 * - ConnectionHandlerError：连接处理器错误类
 * - toConnectionResult：包装器，把 handler 抛错转为 ConnectionHandlerError
 * - buildConstraintConnectionHandlers：构建 kind → handler 映射表
 *
 * 关键现状（不改）：
 * - 子 handler（constraintConnection.handleSchemaToConstraint 等）内部直接调
 *   store.updateNodeData 绕过 tx，是现状
 * - 回退的 validateForInlineSource 异步且不 await（只 .catch），不能变 await
 */

import { logger } from '@/core/utils/logger'
import { validateForInlineSource } from '@/services/constraints/validationRegistryCore'
import {
  getConstraintKindByNodeType,
  isConstraintNodeType,
} from '@/services/constraints/validationRegistry'
import type { ConnectionContext } from './types'
import type { useForeignKeyConnection } from '../constraints/useForeignKeyConnection'
import type { useConditionalConnection } from '../constraints/useConditionalConnection'
import type { useConstraintConnection } from '../constraints/useConstraintConnection'

// ============================================================================
// 错误类 + 包装器（迁移自 useConnections）
// ============================================================================

/**
 * 连接处理器错误类
 * 用于包装连接处理器执行过程中抛出的异常，携带处理器名称和原始错误信息
 */
export class ConnectionHandlerError extends Error {
  constructor(
    public readonly handlerName: string,
    public readonly cause: unknown
  ) {
    super(`连接处理器 [${handlerName}] 执行失败`)
    this.name = 'ConnectionHandlerError'
  }
}

/**
 * 连接处理器包装函数
 * 将各个连接处理器的执行结果统一包装为 Promise，并在出错时抛出 ConnectionHandlerError
 */
export function toConnectionResult<Args extends unknown[]>(
  handlerName: string,
  fn: (...args: Args) => Promise<void>
): (...args: Args) => Promise<void> {
  return (...args: Args) => {
    try {
      const result = fn(...args)
      if (result instanceof Promise) {
        return result.catch((e: unknown) => {
          throw new ConnectionHandlerError(handlerName, e)
        })
      }
      return Promise.resolve(result)
    } catch (e) {
      return Promise.reject(new ConnectionHandlerError(handlerName, e))
    }
  }
}

// ============================================================================
// 约束类型 → handler 映射表构建
// ============================================================================

/** 映射表项的类型 */
type ConstraintHandlerEntry = (
  sourceId: string,
  targetId: string,
  sourceHandleId: string,
  targetHandleId?: string | null,
  edgeId?: string
) => Promise<void>

/**
 * 构建约束类型到连接处理器的映射表
 *
 * 根据约束类型（notNull、unique 等）查找对应的连接处理器。
 * 每个处理器负责处理 Schema 节点到特定约束节点的连接逻辑。
 */
export function buildConstraintConnectionHandlers(params: {
  constraintConnection: ReturnType<typeof useConstraintConnection>
  conditionalConnection: ReturnType<typeof useConditionalConnection>
  foreignKeyConnection: ReturnType<typeof useForeignKeyConnection>
}): Record<string, ConstraintHandlerEntry> {
  const { constraintConnection, conditionalConnection, foreignKeyConnection } = params
  return {
    notNull: toConnectionResult('notNull', (s, t, sh, th) =>
      constraintConnection.handleSchemaToConstraint(s, t, sh, th, {
        kind: 'notNull',
        nodeType: 'notNullConstraint',
        dispatchValidation: true,
        addConstraintToColumn: true,
        resetOnConnect: false,
      })
    ),
    unique: toConnectionResult('unique', (s, t, sh, th) =>
      constraintConnection.handleSchemaToConstraint(s, t, sh, th, {
        kind: 'unique',
        nodeType: 'uniqueConstraint',
        dispatchValidation: true,
        addConstraintToColumn: true,
        resetOnConnect: false,
      })
    ),
    allowedValues: toConnectionResult('allowedValues', (s, t, sh, th) =>
      constraintConnection.handleSchemaToConstraint(s, t, sh, th, {
        kind: 'allowedValues',
        nodeType: 'allowedValuesConstraint',
        dispatchValidation: true,
        addConstraintToColumn: false,
        resetOnConnect: true,
      })
    ),
    range: toConnectionResult('range', (s, t, sh, th) =>
      constraintConnection.handleSchemaToConstraint(s, t, sh, th, {
        kind: 'range',
        nodeType: 'rangeConstraint',
        dispatchValidation: true,
        addConstraintToColumn: false,
        resetOnConnect: true,
      })
    ),
    scripted: toConnectionResult('scripted', (s, t, sh, th) =>
      constraintConnection.handleSchemaToConstraint(s, t, sh, th, {
        kind: 'scripted',
        nodeType: 'scriptedConstraint',
        dispatchValidation: true,
        addConstraintToColumn: false,
        resetOnConnect: true,
      })
    ),
    charset: toConnectionResult('charset', (s, t, sh, th) =>
      constraintConnection.handleSchemaToConstraint(s, t, sh, th, {
        kind: 'charset',
        nodeType: 'charsetConstraint',
        dispatchValidation: true,
        addConstraintToColumn: false,
        resetOnConnect: true,
      })
    ),
    dateLogic: toConnectionResult('dateLogic', (s, t, sh, th) =>
      constraintConnection.handleSchemaToConstraint(s, t, sh, th, {
        kind: 'dateLogic',
        nodeType: 'dateLogicConstraint',
        dispatchValidation: true,
        addConstraintToColumn: false,
        resetOnConnect: true,
      })
    ),
    conditional: toConnectionResult(
      'conditional',
      conditionalConnection.handleSchemaToConditionalConnection
    ),
    foreignKey: toConnectionResult(
      'foreignKey',
      foreignKeyConnection.handleSchemaToForeignKeyConnection
    ),
    // 复合约束是聚合器（通过 includedNodeIds 引用其他约束节点），
    // 连接时只建立锚点边，不触发单约束即时校验（需等子约束全部连接后由全表校验聚合）
    composite: toConnectionResult('composite', (s, t, sh, th) =>
      constraintConnection.handleSchemaToConstraint(s, t, sh, th, {
        kind: 'composite',
        nodeType: 'compositeConstraint',
        dispatchValidation: false,
        addConstraintToColumn: false,
        resetOnConnect: false,
      })
    ),
  }
}

// ============================================================================
// E10: 约束连接核心分发
// ============================================================================

/**
 * 处理约束连接（E10）
 *
 * 源类型：schema / jsonSchema / transformOutput / manualData
 * 目标类型：任意约束类型
 *
 * 分发逻辑：
 * 1. 有 sourceHandle 时，按 constraintKind 查映射表
 * 2. 命中专用 handler → 调用（await）
 * 3. 无专用 handler + 纯数据源 → 回退：设置引用 + 触发 inline 校验（不 await）
 * 4. 无专用 handler + schema/jsonSchema 源 → debug 日志（不支持）
 *
 * 不匹配条件时 no-op。
 */
export async function handleConstraintDispatch(
  ctx: ConnectionContext,
  handlers: Record<string, ConstraintHandlerEntry>
): Promise<void> {
  const { sourceNode, targetNode, sourceHandle, targetHandle, edgeId, tx } = ctx

  if (
    !(
      sourceNode.type === 'schema' ||
      sourceNode.type === 'jsonSchema' ||
      sourceNode.type === 'transformOutput' ||
      sourceNode.type === 'manualData'
    ) ||
    !isConstraintNodeType(targetNode.type)
  ) {
    return
  }

  if (!sourceHandle) return

  const constraintType = getConstraintKindByNodeType(targetNode.type)
  const handler = handlers[constraintType]
  if (handler) {
    await handler(sourceNode.id, targetNode.id, sourceHandle, targetHandle, edgeId)
  } else if (sourceNode.type === 'transformOutput' || sourceNode.type === 'manualData') {
    // 纯数据源 → 无专用处理器的约束类型（如 foreignKey / composite）：
    // 设置基本引用数据，并触发行内校验
    const srcData = sourceNode.data as unknown as Record<string, unknown>
    const colName = (srcData.columnName as string) || 'Column1'
    tx.patchNodeData(targetNode.id, {
      ...((targetNode.data || {}) as unknown as Record<string, unknown>),
      table: (srcData.configName as string) || colName,
      column: colName,
      sourceRef: { nodeId: sourceNode.id, columnId: '0' },
      saveState: 'draft',
    })
    // 触发行内校验（异步，不阻塞连接创建）
    validateForInlineSource({
      sourceNodeId: sourceNode.id,
      constraintNode: targetNode,
      nodes: ctx.store.nodes,
      updateNodeData: ctx.store.updateNodeData,
    }).catch((err) => {
      logger.warn('⚠️ 纯数据源行内校验失败:', err)
    })
    logger.debug('🔗 纯数据源 → 约束节点（回退处理+校验）:', {
      sourceType: sourceNode.type,
      colName,
      constraintType: targetNode.type,
    })
  } else {
    logger.debug('ℹ️ 暂不支持该约束类型的连接处理:', constraintType)
  }
}
