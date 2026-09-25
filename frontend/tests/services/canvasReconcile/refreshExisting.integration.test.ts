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
 * @fileoverview 对账 update 原地刷新集成测试：真实 createV2ImportModule 工厂
 * （注入最小 nodes/edges ref）+ mock vueFlowApi / API 边界，验证 refreshExisting
 * 全链路——update 后节点 data 是磁盘新值、幽灵内嵌约束被移除、边重建、
 * 撤销栈不入 AI 删除。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, nextTick, type Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode, CustomNodeData } from '@/types/graph'
import type { ChangeSetEnvelope } from '@/services/canvasReconcile/envelope'
import { executeReconcilePlan } from '@/services/canvasReconcile/executor'
import { planFromChangeSet } from '@/services/canvasReconcile/planFromChangeSet'

// ---- 共享响应式引用（供 mock 边界同步画布状态）----
let nodesRef: Ref<CustomNode[]> | null = null
let edgesRef: Ref<Edge[]> | null = null

const mocks = vi.hoisted(() => {
  class VueFlowApiNotInitializedError extends Error {
    constructor(message = 'VueFlow API not initialized') {
      super(message)
      this.name = 'VueFlowApiNotInitializedError'
    }
  }
  return {
    getV2Schema: vi.fn(),
    getV2RegexNode: vi.fn(),
    getV2Constraint: vi.fn(),
    getV2FullConfig: vi.fn(),
    toastError: vi.fn(),
    toastWarning: vi.fn(),
    VueFlowApiNotInitializedError,
  }
})

// vueFlowApi 边界 mock：模拟 Vue Flow 增量 API 对 store ref 的回写语义
vi.mock('@/services/canvas/vueFlowApi', () => ({
  VueFlowApiNotInitializedError: mocks.VueFlowApiNotInitializedError,
  addNodes: vi.fn((added: unknown) => {
    const arr = Array.isArray(added) ? added : [added]
    if (nodesRef) nodesRef.value = [...nodesRef.value, ...(arr as CustomNode[])]
  }),
  addEdges: vi.fn((added: unknown) => {
    const arr = Array.isArray(added) ? added : [added]
    if (edgesRef) edgesRef.value = [...edgesRef.value, ...(arr as Edge[])]
  }),
  updateNodeData: vi.fn((nodeId: string, patch: Record<string, unknown>) => {
    if (!nodesRef) return
    const node = nodesRef.value.find((n) => n.id === nodeId)
    if (node) Object.assign(node.data, patch)
  }),
  updateNode: vi.fn((nodeId: string, patch: { position?: { x: number; y: number } }) => {
    if (!nodesRef || !patch.position) return
    const node = nodesRef.value.find((n) => n.id === nodeId)
    if (node) node.position = { ...patch.position }
  }),
  removeEdges: vi.fn((edgeId: string) => {
    if (edgesRef) edgesRef.value = edgesRef.value.filter((e) => e.id !== edgeId)
  }),
  removeNodes: vi.fn((ids: string[] | string) => {
    const idSet = new Set(Array.isArray(ids) ? ids : [ids])
    if (nodesRef) nodesRef.value = nodesRef.value.filter((n) => !idSet.has(n.id))
  }),
  findNode: vi.fn(),
  fitView: vi.fn(),
}))

vi.mock('@/api/projectV2Api', () => ({
  getV2Schema: mocks.getV2Schema,
  getV2RegexNode: mocks.getV2RegexNode,
  getV2Constraint: mocks.getV2Constraint,
  getV2FullConfig: mocks.getV2FullConfig,
  getV2ProjectView: vi.fn(async () => ({})),
  deleteV2ManifestTemplateInstanceRef: vi.fn(async () => undefined),
}))

vi.mock('vue-i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-i18n')>()
  return {
    ...actual,
    useI18n: () => ({ t: (k: string) => k }),
  }
})

vi.mock('@/composables/useGlobalConfirm', () => ({
  useGlobalConfirm: () => ({ showConfirm: vi.fn(async () => true) }),
}))

vi.mock('@/core/toast', () => ({
  toastError: mocks.toastError,
  toastWarning: mocks.toastWarning,
}))

vi.mock('@/core/utils/logger', () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

// ---- 真实被测模块（在 mock 之后导入）----
import { createV2ImportModule } from '@/stores/graphStore/modules/v2Import'
import { createNodeOpsModule } from '@/stores/graphStore/modules/nodeOps'
import { createHistoryModule } from '@/stores/graphStore/modules/history'

function makeNode(
  id: string,
  type: string,
  data: Record<string, unknown>,
  x = 0,
  y = 0
): CustomNode {
  return { id, type, position: { x, y }, data: data as CustomNodeData } as CustomNode
}

function makeEdge(id: string, source: string, target: string): Edge {
  return { id, source, target }
}

function makeEnvelope(
  op: 'add' | 'update' | 'remove',
  kind: string,
  entityId: string
): ChangeSetEnvelope {
  return {
    instructionId: `${op}:${kind}:${entityId}`,
    actionType: 'UPDATE_SCHEMA',
    op,
    kind: kind as ChangeSetEnvelope['kind'],
    entityId,
    filePath: `${kind}s/${entityId}.yaml`,
  }
}

/** 组装真实 v2Import 工厂 + 以其为 rebuild 依赖、nodeOps+history 为 remove 依赖的执行环境 */
function makeReconcileEnv() {
  const nodes = ref<CustomNode[]>([])
  const edges = ref<Edge[]>([])
  nodesRef = nodes
  edgesRef = edges
  const selectedNodeId = ref<string | null>(null)
  const selectedNodeIds = ref<string[]>([])
  const reconcileAll = vi.fn(async () => {})

  // 本地 updateNodeData：模拟 state 模块的 store 回退路径（浅合并进 node.data）
  const updateNodeData = (nodeId: string, patch: Record<string, unknown>) => {
    const node = nodes.value.find((n) => n.id === nodeId)
    if (node) Object.assign(node.data, patch)
  }

  const history = createHistoryModule({ nodes, edges, reconcileAll })
  const nodeOps = createNodeOpsModule({
    nodes,
    edges,
    selectedNodeId,
    selectedNodeIds,
    reconcileAll,
    templateExpand: { getExpandedIds: () => [] },
    clearExpansion: vi.fn(),
    saveState: history.saveState,
    suspendHistory: history.suspend,
    resumeHistory: history.resume,
  })

  const { importV2ResourceToCanvas } = createV2ImportModule({
    nodes,
    edges,
    selectedNodeId,
    getEffectiveProjectConfigPath: () => '/tmp/project/project.precis.yaml',
    resolveProjectRelativePath: (_dir, rel) => (rel ? `/tmp/project/${rel}` : undefined),
    reconcileAll,
    resourceTreeStore: { getResourceById: () => undefined } as never,
    saveState: history.saveState,
    updateNodeData,
  })

  const deps = {
    nodes: () => nodes.value.map((n) => ({ id: n.id, position: n.position })),
    importV2ResourceToCanvas,
    deleteNode: nodeOps.deleteNode,
    positionFor: () => ({ x: 0, y: 0 }),
    getSelectedNodeId: () => selectedNodeId.value,
    setSelectedNodeId: (id: string | null) => {
      selectedNodeId.value = id
    },
  }
  return { nodes, edges, selectedNodeId, nodeOps, history, deps }
}

/** 跑一个信封批次的对账（plan + execute） */
async function runReconcile(
  deps: ReturnType<typeof makeReconcileEnv>['deps'],
  envelopes: ChangeSetEnvelope[]
) {
  return executeReconcilePlan(planFromChangeSet(envelopes), deps)
}

describe('对账 update 原地刷新（真实 v2Import 工厂）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('UPDATE_SCHEMA：列结构刷新为磁盘新值，幽灵内嵌约束移除，内嵌约束与边重建', async () => {
    const env = makeReconcileEnv()
    // 画布旧状态：users（旧列只有 email）、内嵌 notNull 约束（保留）、幽灵 stale 约束（磁盘已删）
    env.nodes.value = [
      makeNode('users', 'schema', {
        tableName: 'users',
        columns: [{ id: 'email', columnName: 'email', dataType: 'String' }],
        saveState: 'saved',
      }),
      makeNode('users_nn_email', 'notNullConstraint', {
        embedded: true,
        configName: '旧配置名',
        table: 'users',
        column: 'email',
        saveState: 'saved',
      }),
      makeNode('users_stale_ghost', 'rangeConstraint', {
        embedded: true,
        configName: '幽灵',
        saveState: 'saved',
      }),
    ]
    env.edges.value = [
      makeEdge('e-users-users_nn_email-email', 'users', 'users_nn_email'),
      makeEdge('e-users-users_stale_ghost-age', 'users', 'users_stale_ghost'),
    ]
    // 磁盘新状态：列新增 phone；内嵌约束只剩 nn_email（params 描述更新）
    mocks.getV2Schema.mockResolvedValue({
      version: 2,
      id: 'users',
      name: 'users',
      columns: [
        { id: 'email', name: 'email', type: 'String' },
        { id: 'phone', name: 'phone', type: 'String' },
      ],
      constraints: [{ id: 'nn_email', type: 'NotNull', column: 'email', description: '新描述' }],
    })

    const outcome = await runReconcile(env.deps, [makeEnvelope('update', 'schema', 'users')])
    await nextTick()

    expect(outcome.updated).toEqual(['users'])
    expect(outcome.failed).toEqual([])

    // ① Schema data 是磁盘新值（快照源即 nodes ref——保存管线从这里克隆）
    const schema = env.nodes.value.find((n) => n.id === 'users')!
    const cols = (schema.data as { columns: Array<{ columnName?: string }> }).columns
    expect(cols.map((c) => c.columnName)).toEqual(['email', 'phone'])

    // ② 幽灵内嵌约束节点与派生边被移除
    expect(env.nodes.value.some((n) => n.id === 'users_stale_ghost')).toBe(false)
    expect(env.edges.value.some((e) => e.id === 'e-users-users_stale_ghost-age')).toBe(false)

    // ③ 保留的内嵌约束 data 被刷新（磁盘新描述）且派生边重建
    const nn = env.nodes.value.find((n) => n.id === 'users_nn_email')
    expect(nn).toBeDefined()
    expect((nn!.data as Record<string, unknown>).configName).toBe('新描述')
    expect(env.edges.value.some((e) => e.id === 'e-users-users_nn_email-email')).toBe(true)

    // ④ 节点未被删除重建（原地刷新：id/位置保持）
    expect(schema.position).toEqual({ x: 0, y: 0 })
  })

  it('UPDATE 独立约束：参数刷新为磁盘新值，旧 data 独有字段清空', async () => {
    const env = makeReconcileEnv()
    env.nodes.value = [
      makeNode('users', 'schema', {
        tableName: 'users',
        columns: [
          { id: 'email', columnName: 'email', dataType: 'String' },
          { id: 'age', columnName: 'age', dataType: 'Integer' },
        ],
      }),
      makeNode('range_users_age', 'rangeConstraint', {
        configName: '旧',
        table: 'users',
        column: 'age',
        minValue: 1,
        maxValue: 10,
        staleField: '旧配置残留',
        validationStatus: 'passed',
        saveState: 'saved',
      }),
    ]
    mocks.getV2Constraint.mockResolvedValue({
      version: 2,
      id: 'range_users_age',
      type: 'Range',
      enabled: true,
      description: '新范围',
      refs: { table_id: 'users', column_id: 'age' },
      params: { min: 18, max: 60 },
    })

    const outcome = await runReconcile(env.deps, [
      makeEnvelope('update', 'constraint', 'range_users_age'),
    ])
    await nextTick()

    expect(outcome.updated).toEqual(['range_users_age'])
    const node = env.nodes.value.find((n) => n.id === 'range_users_age')!
    const data = node.data as Record<string, unknown>
    // 参数是磁盘新值（保存快照源头的 data 即新值，不会被旧值写回磁盘）
    expect(data.minValue).toBe(18)
    expect(data.maxValue).toBe(60)
    // 旧 data 独有字段被清空（整体替换语义）、校验状态重置
    expect(data.staleField).toBeUndefined()
    expect(data.validationStatus).toBe('idle')
  })

  it('UPDATE FK 约束：to_table 变更后旧 FK 展示边被清并按磁盘重建', async () => {
    const env = makeReconcileEnv()
    env.nodes.value = [
      makeNode('users', 'schema', {
        tableName: 'users',
        columns: [{ id: 'uid', columnName: 'uid', dataType: 'Integer' }],
      }),
      makeNode('orders', 'schema', {
        tableName: 'orders',
        columns: [{ id: 'user_ref', columnName: 'user_ref', dataType: 'Integer' }],
      }),
      makeNode('new_target', 'schema', {
        tableName: 'new_target',
        columns: [{ id: 'uid', columnName: 'uid', dataType: 'Integer' }],
      }),
      makeNode('fk_users_orders', 'foreignKeyConstraint', {
        configName: 'FK',
        table: 'users',
        saveState: 'saved',
      }),
    ]
    // 旧 FK 展示边：约束节点 → orders（source=约束节点 + data.kind='fkDisplay'，
    // 磁盘已改为指向 new_target，重放后这条边必须消失）
    env.edges.value = [makeEdge('fk-users-orders-fk_users_orders', 'fk_users_orders', 'orders')]
    ;(env.edges.value[0] as unknown as { data: Record<string, unknown> }).data = {
      kind: 'fkDisplay',
      constraintId: 'fk_users_orders',
      fromTableId: 'users',
      toTableId: 'orders',
    }
    mocks.getV2Constraint.mockResolvedValue({
      version: 2,
      id: 'fk_users_orders',
      type: 'ForeignKey',
      enabled: true,
      description: 'FK',
      refs: {
        from_table_id: 'users',
        from_column_id: 'uid',
        to_table_id: 'new_target',
        to_column_id: 'uid',
      },
      params: {},
    })

    const outcome = await runReconcile(env.deps, [
      makeEnvelope('update', 'constraint', 'fk_users_orders'),
    ])
    await nextTick()

    expect(outcome.updated).toEqual(['fk_users_orders'])
    expect(outcome.failed).toEqual([])
    // 旧 FK 展示边（→ orders）被清理
    expect(env.edges.value.some((e) => e.id === 'fk-users-orders-fk_users_orders')).toBe(false)
    // 新 FK 展示边（→ new_target）按磁盘重建（bufferEdge → flush 后进入 edges）
    expect(
      env.edges.value.some(
        (e) => e.id === 'fk-users-new_target-fk_users_orders' && e.target === 'new_target'
      )
    ).toBe(true)
  })

  it('UPDATE_SCHEMA 类型翻转（source 换成 .json）：保位删旧建新为 jsonSchema', async () => {
    const env = makeReconcileEnv()
    env.nodes.value = [
      makeNode(
        'users',
        'schema',
        {
          tableName: 'users',
          columns: [{ id: 'email', columnName: 'email', dataType: 'String' }],
          sourceFilePath: 'data/users.csv',
          saveState: 'saved',
        },
        120,
        80
      ),
    ]
    // 磁盘：source 换成 .json 文件 → detected type 应为 jsonSchema
    mocks.getV2Schema.mockResolvedValue({
      version: 2,
      id: 'users',
      name: 'users',
      source: { mode: 'relative_file', path: 'data/users.json' },
      columns: [{ id: 'email', name: 'email', type: 'String' }],
      constraints: [],
    })

    const outcome = await runReconcile(env.deps, [makeEnvelope('update', 'schema', 'users')])
    await nextTick()

    expect(outcome.updated).toEqual(['users'])
    const node = env.nodes.value.find((n) => n.id === 'users')!
    // node.type 翻转为 jsonSchema（保存侧序列化路径依赖它），位置保持
    expect(node.type).toBe('jsonSchema')
    expect(node.position).toEqual({ x: 120, y: 80 })
    expect((node.data as Record<string, unknown>).sourceType).toBe('json')
    expect((node.data as Record<string, unknown>).localPath).toContain('users.json')
  })

  it('依赖 schema 磁盘也无：对账 rebuild 计 failed，不建空列名半成品节点', async () => {
    const env = makeReconcileEnv()
    // 画布只有 users（引用的 orders 不在画布），磁盘上 orders 也不存在（getV2Schema 抛错）
    env.nodes.value = [
      makeNode('users', 'schema', {
        tableName: 'users',
        columns: [{ id: 'email', columnName: 'email', dataType: 'String' }],
      }),
    ]
    mocks.getV2Constraint.mockResolvedValue({
      version: 2,
      id: 'notnull_orders_email',
      type: 'NotNull',
      enabled: true,
      description: 'NN',
      refs: { table_id: 'orders', column_id: 'email' },
      params: {},
    })
    mocks.getV2Schema.mockRejectedValue(new Error('schema file not found: orders'))

    const outcome = await runReconcile(env.deps, [
      makeEnvelope('update', 'constraint', 'notnull_orders_email'),
    ])
    await nextTick()

    // 半成品节点未建，操作计 failed（走既有失败呈现链路）
    expect(outcome.failed).toHaveLength(1)
    expect(outcome.failed[0]).toMatchObject({ entityId: 'notnull_orders_email' })
    expect(env.nodes.value.some((n) => n.id === 'notnull_orders_email')).toBe(false)
    expect(outcome.added).toEqual([])
    expect(outcome.updated).toEqual([])
  })

  it('依赖 schema 磁盘上有但未上画布：守卫先裸补 schema 再导约束（自愈，非半成品）', async () => {
    const env = makeReconcileEnv()
    env.nodes.value = [
      makeNode('users', 'schema', {
        tableName: 'users',
        columns: [{ id: 'email', columnName: 'email', dataType: 'String' }],
      }),
    ]
    // orders 在磁盘（守卫 ensureSchemaNode 能建），列名可正常解析
    mocks.getV2Schema.mockImplementation(async (id: string) =>
      id === 'orders'
        ? {
            version: 2,
            id: 'orders',
            name: 'orders',
            columns: [{ id: 'email', name: 'email', type: 'String' }],
            constraints: [],
          }
        : {
            version: 2,
            id,
            name: id,
            columns: [{ id: 'email', name: 'email', type: 'String' }],
            constraints: [],
          }
    )
    mocks.getV2Constraint.mockResolvedValue({
      version: 2,
      id: 'notnull_orders_email',
      type: 'NotNull',
      enabled: true,
      description: 'NN',
      refs: { table_id: 'orders', column_id: 'email' },
      params: {},
    })

    const outcome = await runReconcile(env.deps, [
      makeEnvelope('add', 'constraint', 'notnull_orders_email'),
    ])
    await nextTick()

    // 约束成功导入且列名真实解析（非空列名半成品），依赖 schema 被裸补上画布
    expect(outcome.failed).toEqual([])
    expect(outcome.added).toEqual(['notnull_orders_email'])
    const node = env.nodes.value.find((n) => n.id === 'notnull_orders_email')
    expect(node).toBeDefined()
    expect((node!.data as Record<string, unknown>).column).toBe('email')
    expect(env.nodes.value.some((n) => n.id === 'orders')).toBe(true)
  })

  it('对账 remove 不入撤销栈（Ctrl+Z 无法复活磁盘已删实体），手动删除仍入栈', async () => {
    const env = makeReconcileEnv()
    env.nodes.value = [
      makeNode('users', 'schema', { tableName: 'users', columns: [] }),
      makeNode('ghost', 'regex', { configName: '待删' }),
    ]
    const depthBefore = env.history.undoStack.value.length

    await runReconcile(env.deps, [makeEnvelope('remove', 'regex', 'ghost')])
    await new Promise((r) => setTimeout(r, 0))

    expect(env.nodes.value.some((n) => n.id === 'ghost')).toBe(false)
    // AI 对账删除：撤销栈深度不变
    expect(env.history.undoStack.value.length).toBe(depthBefore)

    // 手动删除（默认 recordHistory）正常入栈——既有调用方行为不受影响
    await env.nodeOps.deleteNode('users')
    expect(env.history.undoStack.value.length).toBe(depthBefore + 1)
  })
})
