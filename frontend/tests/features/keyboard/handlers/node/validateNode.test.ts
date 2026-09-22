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
 * @fileoverview Ctrl+Enter 校验选中 Schema 的误报红线回归测试
 *
 * 场景一（根因修复）：V2 导入的 Schema 只写 sourceFilePath/localPath 不写
 * sourceFile（sourceFile 仅数据源连线场景写入的展示名），修复前 requireSource
 * 把这类约束全部判为 idle，校验实际未发生却 toast"校验全部通过"。
 *
 * 场景二（误报修复）：校验收集器能从连线的数据源节点解析出路径、但 Schema
 * 节点自身无路径（ctx 无 sourceFilePath）时全部约束 idle——修复前 summary
 * valid=invalid=0 仍命中"全部通过"分支；修复后必须报"未执行校验：缺少数据源"。
 *
 * mock 边界：graphStore（Pinia）、HTTP/api 层（validationApi）、渲染层
 * （vueFlowApi.updateEdgeData）、regex 子模块。校验链路本身真实执行。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const graphState: {
  selectedNodeId: string
  nodes: any[]
  edges: any[]
  updates: Record<string, any>
} = {
  selectedNodeId: 'schema-1',
  nodes: [],
  edges: [],
  updates: {},
}

vi.mock('@/stores/graphStore', () => ({
  useGraphStore: () => ({
    get selectedNodeId() {
      return graphState.selectedNodeId
    },
    get nodes() {
      return graphState.nodes
    },
    get edges() {
      return graphState.edges
    },
    updateNodeData: (nodeId: string, data: Record<string, unknown>) => {
      graphState.updates[nodeId] = { ...graphState.updates[nodeId], ...data }
    },
  }),
}))

vi.mock('@/api/validationApi', () => ({
  validateNotNull: vi.fn(),
  validateUnique: vi.fn(),
  validateInline: vi.fn(),
  validateForeignKey: vi.fn(),
  validateRange: vi.fn(),
  validateAllowedValues: vi.fn(),
  validateCharset: vi.fn(),
  validateConditional: vi.fn(),
  validateDateLogic: vi.fn(),
  validateScripted: vi.fn(),
}))

vi.mock('@/services/canvas/vueFlowApi', () => ({
  updateEdgeData: vi.fn(),
}))

vi.mock('@/services/regex/regexValidationHandler', () => ({
  validateRegexNodesForSchema: vi.fn().mockResolvedValue(null),
}))

import { validateNotNull as apiValidateNotNull } from '@/api/validationApi'
import { validateSelectedNode } from '@/features/keyboard/handlers/node/validateNode'

// 工厂：V2 导入链路（v2/import/schema.ts ensureSchemaNode）写入的 Schema 节点 shape
function makeV2ImportedSchemaNode() {
  return {
    id: 'schema-1',
    type: 'schema',
    position: { x: 0, y: 0 },
    data: {
      configName: 'Schema_users',
      tableName: 'users',
      sourceFilePath: 'data/users.csv',
      localPath: 'D:/proj/data/users.csv',
      sourcePathMode: 'relative_file',
      sourceMode: 'localfile',
      headerRow: 0,
      // 注意：无 sourceFile —— V2 导入不写展示名
      columns: [{ id: 'col-1', columnName: 'email', dataType: 'string' }],
    },
  }
}

function makeNotNullConstraintNode() {
  return {
    id: 'notnull-1',
    type: 'notNullConstraint',
    position: { x: 200, y: 0 },
    data: {},
  }
}

function makeConstraintEdge() {
  return {
    id: 'e-schema-constraint',
    source: 'schema-1',
    target: 'notnull-1',
    sourceHandle: 'source-right-col-1',
    targetHandle: 'target-left',
  }
}

function resetGraph(nodes: any[], edges: any[]) {
  graphState.nodes = nodes
  graphState.edges = edges
  graphState.updates = {}
  graphState.selectedNodeId = 'schema-1'
}

describe('validateSelectedNode - V2 导入 Schema 校验链路', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('V2 导入的 Schema（仅 sourceFilePath，无 sourceFile）真实执行校验并按结果报通过', async () => {
    vi.mocked(apiValidateNotNull).mockResolvedValue({
      success: true,
      validation_type: 'not_null',
      data: {
        is_valid: true,
        error_count: 0,
        total_rows: 5,
        match_count: 5,
        error_rows: [],
        validation_time: '2026-01-01T00:00:00Z',
      },
      error: null,
    } as any)

    resetGraph([makeV2ImportedSchemaNode(), makeNotNullConstraintNode()], [makeConstraintEdge()])

    const result = await validateSelectedNode()

    // 校验真实发生：后端 API 按路径调用（localPath 优先）
    expect(apiValidateNotNull).toHaveBeenCalledTimes(1)
    expect(apiValidateNotNull).toHaveBeenCalledWith(
      expect.objectContaining({
        validation_type: 'not_null',
        target_column_name: 'email',
        source_file_path: 'D:/proj/data/users.csv',
      })
    )

    // 摘要与消息口径一致：1 项约束、1 项通过、0 项跳过
    expect(result.summary).toEqual({
      total: 1,
      valid: 1,
      invalid: 0,
      errors: 0,
      skipped: 0,
    })
    expect(result.message).toBe('shortcuts.feedback.validationAllPassed')

    // 约束节点写回真实校验状态（非 idle）
    expect(graphState.updates['notnull-1'].validationStatus).toBe('pass')
  })

  it('校验未执行（约束全部 idle）时报"未执行校验"，不报"校验全部通过"', async () => {
    // 场景：收集器可从连线的数据源节点解析出路径（闸门放行进入批量校验），
    // 但 Schema 节点自身无任何路径字段 → ctx.sourceFilePath 缺失 → 约束 idle
    const schemaWithoutPath = {
      id: 'schema-1',
      type: 'schema',
      position: { x: 0, y: 0 },
      data: {
        tableName: 'users',
        columns: [{ id: 'col-1', columnName: 'email', dataType: 'string' }],
      },
    }
    const sourcePreview = {
      id: 'sp-1',
      type: 'sourcePreview',
      position: { x: -200, y: 0 },
      data: { localPath: 'D:/proj/data/orders.csv', sourceName: 'orders.csv' },
    }
    const sourceEdge = {
      id: 'e-source-schema',
      source: 'sp-1',
      target: 'schema-1',
      targetHandle: 'target-left',
    }

    resetGraph(
      [schemaWithoutPath, sourcePreview, makeNotNullConstraintNode()],
      [sourceEdge, makeConstraintEdge()]
    )

    const result = await validateSelectedNode()

    // 约束被处理（total=1）但全部 idle：HTTP 校验从未发生
    expect(apiValidateNotNull).not.toHaveBeenCalled()
    expect(result.summary).toEqual({
      total: 1,
      valid: 0,
      invalid: 0,
      errors: 0,
      skipped: 1,
    })

    // 误报红线：不得报"校验全部通过"
    expect(result.message).not.toBe('shortcuts.feedback.validationAllPassed')
    expect(result.message).toBe('shortcuts.feedback.validationNotExecuted')

    // 约束节点状态如实写回 idle
    expect(graphState.updates['notnull-1'].validationStatus).toBe('idle')
  })

  it('Schema 完全无数据源时走"没有连接的约束"中性提示（total=0）', async () => {
    const schemaWithoutPath = {
      id: 'schema-1',
      type: 'schema',
      position: { x: 0, y: 0 },
      data: {
        tableName: 'users',
        columns: [{ id: 'col-1', columnName: 'email', dataType: 'string' }],
      },
    }
    resetGraph([schemaWithoutPath, makeNotNullConstraintNode()], [makeConstraintEdge()])

    const result = await validateSelectedNode()

    expect(apiValidateNotNull).not.toHaveBeenCalled()
    expect(result.summary?.total).toBe(0)
    expect(result.message).toBe('shortcuts.feedback.validationNoConstraints')
  })

  it('部分通过部分跳过时不报"全部通过"', async () => {
    vi.mocked(apiValidateNotNull).mockResolvedValue({
      success: true,
      validation_type: 'not_null',
      data: {
        is_valid: true,
        error_count: 0,
        total_rows: 5,
        match_count: 5,
        error_rows: [],
        validation_time: '2026-01-01T00:00:00Z',
      },
      error: null,
    } as any)

    // 混合场景：同一 V2 导入 Schema 下，notNull 真实通过（valid），
    // 外键约束因目标表无可用数据返回 missing（skipped，校验未执行）
    const v2Schema = makeV2ImportedSchemaNode()
    v2Schema.data.columns = [
      { id: 'col-1', columnName: 'email', dataType: 'string' },
      { id: 'col-2', columnName: 'role', dataType: 'string' },
    ]
    const targetSchema = {
      id: 'schema-target',
      type: 'schema',
      position: { x: 400, y: 0 },
      data: {
        tableName: 'roles',
        columns: [{ id: 'tcol-1', columnName: 'role', dataType: 'string' }],
      },
    }
    const fkConstraint = {
      id: 'fk-1',
      type: 'foreignKeyConstraint',
      position: { x: 200, y: 150 },
      data: { targetRef: { nodeId: 'schema-target', columnId: 'tcol-1' } },
    }

    resetGraph(
      [v2Schema, targetSchema, makeNotNullConstraintNode(), fkConstraint],
      [
        makeConstraintEdge(),
        {
          id: 'e-schema1-fk',
          source: 'schema-1',
          target: 'fk-1',
          sourceHandle: 'source-right-col-2',
          targetHandle: 'target-left',
        },
      ]
    )

    const result = await validateSelectedNode()

    expect(result.summary).toEqual({
      total: 2,
      valid: 1,
      invalid: 0,
      errors: 0,
      skipped: 1,
    })
    // 有跳过项：不得报"全部通过"，落入通用"校验完成"
    expect(result.message).not.toBe('shortcuts.feedback.validationAllPassed')
    expect(result.message).toBe('shortcuts.feedback.validationCompleted')

    // 外键约束如实写回 missing 状态
    expect(graphState.updates['fk-1'].validationStatus).toBe('missing')
  })
})
