/**
 * @file shortcutHandlers.ts
 * @description 快捷连接处理（A1-A4：创建边之前的提前返回分支）
 *
 * 处理"不需要走标准创建边 + 事务流程"的特殊连接：
 * - A1 patternToolbox → schema：拖拽 pattern 到 schema 列，自动导入 regex 节点并绑定
 * - A2 pattern → regex/regexExtract：吸附效果，创建临时边 600ms 后删除（含闭包异步）
 * - A3 FK 快捷手势 schema→schema：自动生成 FK 节点
 * - A4 sourcePreview → foreignKeyConstraint：警告并拒绝（外键不支持 SourcePreview 直连）
 *
 * 契约：返回 { handled: true } 表示已处理（外层直接 return，不再创建边）；
 * { handled: false } 表示不匹配，继续主流程。
 *
 * 重要语义：原 handleConnectionCompleted 中，A1/A2 一旦进入外层 if 块，
 * 内部所有 return 都是从外层函数返回（= handled:true），不会落入主流程。
 * 本拆分严格保持此语义。
 *
 * 注意：这些 handler 在边创建之前执行，**不接收事务上下文**（无 tx/edgeId）。
 */

import { logger } from '@/core/utils/logger'
import { useProjectStore } from '@/stores/projectStore'
import { useGraphStore } from '@/stores/graphStore'
import { getV2FullConfig } from '@/api/projectV2Api'
import type { PatternRegistryTypeV2 } from '@/types/projectV2'
import type { BaseConnectionContext } from './types'
import type { useForeignKeyConnection } from '../constraints/useForeignKeyConnection'

/** 快捷处理结果 */
export interface ShortcutResult {
  /** true 表示已处理，外层应直接 return */
  handled: boolean
}

/** 外部依赖注入 */
export interface ShortcutHandlerDeps {
  /** 完整 store（快捷分支需要 createConnection/deleteNode/importV2 等方法） */
  store: ReturnType<typeof useGraphStore>
  foreignKeyConnection: ReturnType<typeof useForeignKeyConnection>
}

/**
 * 尝试处理快捷连接（A1-A4）
 *
 * 按顺序检查每个快捷分支，命中则处理并返回 { handled: true }。
 * 全部不匹配返回 { handled: false }，继续主流程。
 */
export async function tryHandleShortcutConnection(
  ctx: BaseConnectionContext,
  deps: ShortcutHandlerDeps
): Promise<ShortcutResult> {
  const { sourceNode, targetNode, sourceHandle, targetHandle } = ctx
  const { store, foreignKeyConnection } = deps

  // A1: patternToolbox → schema（拖拽 pattern 到 schema 列）
  // 进入此分支即 handled，内部 return 对应原代码从外层函数返回
  if (sourceNode.type === 'patternToolbox' && targetNode.type === 'schema') {
    await runPatternToolboxToSchema({ sourceNode, targetNode, sourceHandle, targetHandle }, store)
    return { handled: true }
  }

  // A2: pattern/schema → regex/regexExtract（仅 pattern 源走吸附，schema 源由主流程处理）
  if (
    (sourceNode.type === 'pattern' || sourceNode.type === 'schema') &&
    (targetNode.type === 'regex' || targetNode.type === 'regexExtract')
  ) {
    const regexTargetInputHandle =
      targetNode.type === 'regexExtract' ? 'regexExtract-input' : 'regex-input'
    if (!targetHandle || targetHandle === regexTargetInputHandle) {
      if (sourceNode.type === 'pattern') {
        // pattern 源走吸附：进入即 handled
        await runPatternToRegexAbsorb({ sourceNode, targetNode }, store, regexTargetInputHandle)
        return { handled: true }
      }
      // schema 源不拦截，继续主流程（由 regexHandlers 处理）
    }
  }

  // A3: FK 快捷手势 schema→schema（自动生成 FK 节点）
  const shortcutCreatedNodeId =
    foreignKeyConnection.handleSchemaToSchemaForeignKeyShortcutConnection(
      sourceNode.id,
      targetNode.id,
      sourceHandle ?? undefined,
      targetHandle ?? undefined,
      {
        type: 'smoothstep',
        animated: true,
        style: { stroke: 'var(--edge-default)', strokeWidth: 1.5 },
      }
    )
  if (shortcutCreatedNodeId) {
    return { handled: true }
  }

  // A4: sourcePreview → foreignKeyConstraint（警告并拒绝）
  if (sourceNode.type === 'sourcePreview' && targetNode.type === 'foreignKeyConstraint') {
    logger.warn('⚠️ 当前外键节点不支持从 SourcePreview 直接建立参照连接')
    return { handled: true }
  }

  return { handled: false }
}

// ============================================================================
// A1: patternToolbox → schema
// ============================================================================

async function runPatternToolboxToSchema(
  ctx: {
    sourceNode: BaseConnectionContext['sourceNode']
    targetNode: BaseConnectionContext['targetNode']
    sourceHandle: string | null | undefined
    targetHandle: string | null | undefined
  },
  store: ReturnType<typeof useGraphStore>
): Promise<void> {
  const { targetNode, sourceHandle, targetHandle } = ctx
  const patternId =
    sourceHandle && sourceHandle.startsWith('pattern-') ? sourceHandle.replace('pattern-', '') : ''
  const columnId =
    targetHandle && targetHandle.startsWith('pattern-drop-')
      ? targetHandle.replace('pattern-drop-', '')
      : ''
  if (!patternId || !columnId) return

  const basePos = {
    x: (targetNode.position?.x || 0) + 420,
    y: targetNode.position?.y || 0,
  }
  const regexNodeId = await store.importV2ResourceToCanvas('pattern', patternId, basePos, {
    includeDeps: false,
    moveIfExists: true,
  })
  if (!regexNodeId) return

  store.bindRegexToSchemaColumn(targetNode.id, columnId, regexNodeId)
}

// ============================================================================
// A2: pattern → regex/regexExtract（吸附效果）
// ============================================================================

async function runPatternToRegexAbsorb(
  ctx: {
    sourceNode: BaseConnectionContext['sourceNode']
    targetNode: BaseConnectionContext['targetNode']
  },
  store: ReturnType<typeof useGraphStore>,
  regexTargetInputHandle: string
): Promise<void> {
  const { sourceNode, targetNode } = ctx
  const patternNodeData = sourceNode.data as unknown as Record<string, unknown>
  const regexNodeData = targetNode.data as unknown as Record<string, unknown>

  const patternId = patternNodeData?.patternId as string | undefined
  const registry = patternNodeData?.registry as PatternRegistryTypeV2 | undefined

  // 从完整路径中提取纯 ID，例如 "patterns/email" -> "email"
  const purePatternId = patternId?.includes('/') ? patternId.split('/').pop() : patternId

  if (!patternId || !registry) {
    return
  }

  const projectStore = useProjectStore()
  const configPath = projectStore.currentPaths?.configPath

  if (!configPath) {
    return
  }

  const fullConfig = await getV2FullConfig(configPath)
  const registryKey = `${registry}/${purePatternId}`

  const patternData = fullConfig.regex_registries?.[registryKey] as
    | {
        definition?: {
          pattern?: string
          regex?: string
          flags?: string
          case_sensitive?: boolean
        }
      }
    | undefined

  if (!patternData) {
    return
  }

  const definition = patternData.definition
  const patternContent = definition?.pattern || definition?.regex || ''

  const updatedRegexData = {
    ...regexNodeData,
    uses_pattern: {
      registry,
      pattern_name: purePatternId,
    },
    pattern: patternContent,
    flags: definition?.flags || 'g',
    caseSensitive: definition?.case_sensitive ?? true,
    saveState: 'draft' as const,
    validationStatus: 'idle' as const,
  }

  store.updateNodeData(targetNode.id, updatedRegexData)

  // 创建一条"流动吸附"的连接线
  const edgeStyle = {
    type: 'smoothstep' as const,
    animated: true,
    style: { stroke: 'var(--node-accent)', strokeWidth: 2 },
    data: { isAbsorbing: true },
  }
  const edgeId = store.createConnection(
    sourceNode.id,
    targetNode.id,
    'pattern-output',
    regexTargetInputHandle,
    edgeStyle
  )

  // 600ms 后删除连接线，模拟"被吸收"的效果
  // 注意：此 setTimeout 闭包在 return 之后仍执行，引用 sourceNode.id/edgeId，
  // 不受事务 rollback 影响（A2 本就不走事务流程）
  setTimeout(() => {
    store.deleteConnection(edgeId)
    store.deleteNode(sourceNode.id)
  }, 600)

  logger.debug(
    `[Pattern→${targetNode.type === 'regexExtract' ? 'RegexExtract' : 'Regex'}] 已将 pattern '${patternId}' (${registry}) 关联到 ${targetNode.type} 节点 '${targetNode.id}'`
  )
}
