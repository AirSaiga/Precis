/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copyright 2026 Precis Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * @fileoverview 对账计划执行器：把 planFromChangeSet 产出的操作逐条落到画布。
 *
 * rebuild → graphStore.importV2ResourceToCanvas（磁盘重读，幂等；与
 * hydrateResourcesFromConfig 相同选项组合，不入撤销栈；节点已存在时传
 * refreshExisting 走原地刷新，保证 update 语义真正重读磁盘）；
 * remove → graphStore.deleteNode（nodeOps 级联清理范本，recordHistory:false
 * 不入撤销栈——磁盘已删的实体不应可被 Ctrl+Z 复活）。
 * 依赖经 ReconcileDeps 注入（生产环境绑定 graphStore，测试注入最小实现）。
 */

import { logger } from '@/core/utils/logger'
import { VueFlowApiNotInitializedError } from '@/services/canvas/vueFlowApi'
import type { ReconcilePlan } from './planFromChangeSet'
import type { ChangeSetKind } from './envelope'

/** 单条操作失败记录（instructionId 供遥测对账，entityId 供展示） */
export interface ReconcileFailure {
  instructionId: string
  entityId: string
  error: string
}

/** 一批对账的执行结果（entityId 列表 + 失败清单） */
export interface ReconcileOutcome {
  added: string[]
  updated: string[]
  removed: string[]
  failed: ReconcileFailure[]
}

/** 画布节点最小只读视图（避免执行器依赖完整 store 类型） */
export interface CanvasNodeView {
  id: string
  position: { x: number; y: number }
  /** 节点保存状态（'draft' = 用户未保存的编辑；快照重放跳过覆盖的保护判据） */
  saveState?: unknown
}

/** 执行器依赖（生产绑定 graphStore；测试注入最小实现） */
export interface ReconcileDeps {
  /** 当前画布节点只读快照（每次调用取最新） */
  nodes: () => CanvasNodeView[]
  /** 磁盘重读幂等导入（rebuild 动作；refreshExisting=true 时已存在节点原地刷新） */
  importV2ResourceToCanvas: (
    kind: 'schema' | 'constraint' | 'regex' | 'transform',
    resourceId: string,
    position: { x: number; y: number },
    options: {
      includeDeps: false
      moveIfExists: false
      skipRelatedConstraints: true
      recordHistory: false
      refreshExisting: boolean
    }
  ) => Promise<string | null>
  /** 级联删除画布节点（remove 动作；节点不存在时 no-op；recordHistory:false 不入撤销栈） */
  deleteNode: (nodeId: string, options?: { recordHistory?: boolean }) => Promise<void> | void
  /** 新节点落点计算（默认：当前画布右外侧自然错开） */
  positionFor: () => { x: number; y: number }
  /** rebuild 成功后的取景回调（流式画布生长；可选） */
  fitViewNode?: (nodeId: string) => void
  /** 选中保持（对齐 hydrate 范本：后台同步不抢用户选中；可选，测试可不注入） */
  getSelectedNodeId?: () => string | null
  setSelectedNodeId?: (id: string | null) => void
}

/** 信封 kind 中当前可导入画布的子集（manualData/template 为契约预留，暂无导入工厂分支） */
const IMPORTABLE_KINDS: ReadonlySet<ChangeSetKind> = new Set([
  'schema',
  'constraint',
  'regex',
  'transform',
])

export function emptyReconcileOutcome(): ReconcileOutcome {
  return { added: [], updated: [], removed: [], failed: [] }
}

/** 跨批次聚合视图（聊天消息级同步摘要的数据源） */
export interface AggregatedReconcile {
  added: number
  updated: number
  removed: number
  failed: ReconcileFailure[]
  /** 摊平后的实体级操作记录（entityId 去重，后到覆盖——同实体多批次时以终态为准） */
  touchedEntityIds: string[]
}

/** 把多条消息内多次入队的执行结果聚合为单一摘要 */
export function aggregateReconcileOutcomes(outcomes: ReconcileOutcome[]): AggregatedReconcile {
  const agg: AggregatedReconcile = {
    added: 0,
    updated: 0,
    removed: 0,
    failed: [],
    touchedEntityIds: [],
  }
  const touched = new Set<string>()
  for (const o of outcomes) {
    agg.added += o.added.length
    agg.updated += o.updated.length
    agg.removed += o.removed.length
    agg.failed.push(...o.failed)
    for (const id of [...o.added, ...o.updated, ...o.removed]) touched.add(id)
  }
  agg.touchedEntityIds = [...touched]
  return agg
}

/**
 * 执行一个对账计划。逐条串行；单条失败捕获后继续（失败不中断队列），
 * 结果按"执行时画布是否已有该节点"归类 added / updated。
 *
 * 选中保持：每条操作前后保存/恢复 selectedNodeId（对齐 hydrateResourcesFromConfig
 * 的"导入后恢复选中"范本——对账是后台同步，不应把检查器抢到任意实体上）。
 */
export async function executeReconcilePlan(
  plan: ReconcilePlan,
  deps: ReconcileDeps
): Promise<ReconcileOutcome> {
  const outcome = emptyReconcileOutcome()

  for (const op of plan.ops) {
    // 选中保持（可选依赖未注入时跳过）
    const selectionBefore = deps.getSelectedNodeId?.() ?? null
    const restoreSelection = () => deps.setSelectedNodeId?.(selectionBefore)

    try {
      if (op.op === 'remove') {
        const existed = deps.nodes().some((n) => n.id === op.entityId)
        if (!existed) continue // 契约：remove 对不存在节点是 no-op
        // recordHistory:false——磁盘已删的实体不入撤销栈，防 Ctrl+Z 复活后被保存写回。
        // 注意不 restore 选中：nodeOps.deleteNode 已正确清理（删的是选中节点 → 置 null；
        // 非选中 → 不动），无脑恢复会把刚删除的节点 id 写回 selectedNodeId（悬空选中）
        await deps.deleteNode(op.entityId, { recordHistory: false })
        outcome.removed.push(op.entityId)
        continue
      }

      if (!IMPORTABLE_KINDS.has(op.kind)) {
        outcome.failed.push({
          instructionId: op.instructionId,
          entityId: op.entityId,
          error: `unsupported kind for canvas reconcile: ${op.kind}`,
        })
        continue
      }

      const existedBefore = deps.nodes().some((n) => n.id === op.entityId)
      if (existedBefore) {
        // draft 保护：completed 快照是权威全量列表、整批幂等重放——若目标节点带有用户
        // 未保存的编辑（saveState === 'draft'），重放会用磁盘旧值静默覆盖用户输入。
        // 取舍：跳过覆盖、保留 draft（用户保存时画布 draft 优先写盘是保存管线既有语义；
        // 代价是该实体画布暂时偏离磁盘）。跳过不是错误：不计 failed、不计 updated。
        const target = deps.nodes().find((n) => n.id === op.entityId)
        if (target?.saveState === 'draft') {
          logger.info(
            '[canvasReconcile] 节点处于 draft（用户未保存的编辑），跳过磁盘重放覆盖:',
            op.entityId
          )
          restoreSelection()
          continue
        }
      }
      const nodeId = await deps.importV2ResourceToCanvas(
        // IMPORTABLE_KINDS 守卫后收窄（Set.has 无 narrowing，显式断言到导入工厂的 kind 子集）
        op.kind as 'schema' | 'constraint' | 'regex' | 'transform',
        op.entityId,
        deps.positionFor(),
        {
          includeDeps: false,
          moveIfExists: false,
          skipRelatedConstraints: true,
          recordHistory: false,
          // 节点已存在 → 本次 rebuild 是 update 语义，走原地刷新（磁盘为准重读 data）；
          // 不存在 → 创建。add 与 update 折叠后的统一动作由此保持两种语义各自正确
          refreshExisting: existedBefore,
        }
      )
      restoreSelection()
      if (!nodeId) {
        // importer 内部已 toast 具体原因（如资源不存在），此处仅记账
        outcome.failed.push({
          instructionId: op.instructionId,
          entityId: op.entityId,
          error: `import returned no node (resource missing or load failed): ${op.entityId}`,
        })
        continue
      }
      if (existedBefore) {
        outcome.updated.push(op.entityId)
      } else {
        outcome.added.push(op.entityId)
      }
      deps.fitViewNode?.(nodeId)
    } catch (error) {
      restoreSelection()
      // 模式切换窗口期（NodeCanvas 重建、vueFlowApi 单例被置空）是可预期降级：
      // 静默跳过即可，不记 failed（避免触发"建议重新加载项目"的误导性失败提示）；
      // 切换前 appModeStore 会先 awaitPendingInstructions，此路径仅兜底极端时序
      if (error instanceof VueFlowApiNotInitializedError) {
        logger.warn('[canvasReconcile] 画布未就绪（模式切换窗口期），跳过对账操作:', {
          instructionId: op.instructionId,
          entityId: op.entityId,
        })
        continue
      }
      // 单条失败不中断队列：收集进 failed，继续处理后续操作
      logger.warn('[canvasReconcile] 单条对账操作失败，跳过继续:', {
        instructionId: op.instructionId,
        entityId: op.entityId,
        error,
      })
      outcome.failed.push({
        instructionId: op.instructionId,
        entityId: op.entityId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return outcome
}
