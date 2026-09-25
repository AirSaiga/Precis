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
 * @file schema.ts
 * @description V2 Schema 导入模块
 *
 * 负责将 V2 项目配置中的 Schema（表结构）导入到画布节点中。
 * 包括从后端加载 Schema 定义、创建 Schema 节点、解析列信息、
 * 处理数据源路径（绝对/相对文件路径）以及物化内嵌约束。
 *
 * 核心功能：
 * - ensureSchemaNode: 确保指定 Schema 节点存在于画布中（幂等）
 * - materializeEmbeddedConstraints: 将 Schema 内嵌约束转换为画布节点和边
 * - importSchema: 完整的 Schema 导入流程（加载 + 创建节点 + 物化约束）
 * - refreshSchemaNode: 已存在节点的原地刷新（对账 update 语义，磁盘为准）
 *
 * 数据流：
 * V2 配置 → getV2Schema API → TableSchemaFileV2 → CustomNode(schema) → 画布
 */

import { nextTick, type Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode, CustomNodeData, SchemaNodeData } from '@/types/graph'
import type { JSONOptionsV2, TableSchemaFileV2 } from '@/types/projectV2'
import { getV2Schema } from '@/api/projectV2Api'
import { parseColumnSpecs } from '@/services/builders/parseColumnSpec'
import { materializeV2EmbeddedConstraints } from '../shared/embeddedConstraints'
import { normalizeTransportPath } from '@/core/utils/pathNormalization'
import { addNodes, removeEdges, removeNodes } from '@/services/canvas/vueFlowApi'
import { isConstraintNodeType } from '@/services/constraints/validationRegistry'
import { nodeDataGet, nodeDataKeys } from '../shared/nodeDataRead'
import { logger } from '@/core/utils/logger'

/**
 * 从磁盘 Schema 文件构建画布节点 data（创建与原地刷新共用，保证两路数据形状恒等）。
 */
function buildSchemaNodeData(
  schema: TableSchemaFileV2,
  getEffectiveProjectConfigPath: () => string | undefined,
  resolveProjectRelativePath: (
    configDir: string | undefined,
    relPath: string | undefined
  ) => string | undefined
): Record<string, unknown> {
  // 检测是否为 JSON schema：根据文件扩展名判断（与后端 SourceSpec.is_json() 一致）
  const sourcePathForDetection = schema.source?.path || ''
  const isJsonSchema = /\.(json|jsonl|ndjson)$/i.test(sourcePathForDetection)

  // 列解析统一走 parseColumnSpecs（含 Expr/Extracted 还原、嵌套 children、JSON 类型映射）
  const cols = parseColumnSpecs(schema.columns || [], { isJsonSchema })
  const configPath = getEffectiveProjectConfigPath()
  // 默认回退为 relative_file，防止后端返回的 mode 为空或未声明时 localPath 丢失
  const sourcePathMode = schema.source?.mode || 'relative_file'
  const rawLocalPath =
    sourcePathMode === 'absolute_file'
      ? schema.source?.path
      : sourcePathMode === 'relative_file'
        ? resolveProjectRelativePath(configPath, schema.source?.path)
        : undefined
  const localPath = rawLocalPath ? normalizeTransportPath(rawLocalPath) : undefined

  return {
    configName: `Schema_${schema.name}`,
    tableName: schema.name,
    // JSON schema 不需要 sheet
    sheetName: isJsonSchema ? undefined : (schema.source?.sheet ?? schema.sheet),
    sourceFilePath: schema.source?.path,
    headerRow: schema.source?.header_row ?? 0,
    sourcePathMode,
    sourceMode: 'localfile',
    localPath,
    columns: cols,
    saveState: 'saved',
    sourceType: isJsonSchema ? 'json' : undefined,
    format: (schema.source?.options as JSONOptionsV2 | undefined)?.format,
    jsonPath: (schema.source?.options as JSONOptionsV2 | undefined)?.json_path,
    recordPath: (schema.source?.options as JSONOptionsV2 | undefined)?.record_path,
  }
}

/** 从内嵌约束条目推导画布节点 id（与 materializeV2EmbeddedConstraints 同一套确定性规则） */
function embeddedConstraintNodeId(schemaNodeId: string, rawId: string): string {
  return rawId.startsWith(`${schemaNodeId}_`) ? rawId : `${schemaNodeId}_${rawId}`
}

export function createV2SchemaImporter(params: {
  nodes: Ref<CustomNode[]>
  edges: Ref<Edge[]>
  getEffectiveProjectConfigPath: () => string | undefined
  resolveProjectRelativePath: (
    configDir: string | undefined,
    relPath: string | undefined
  ) => string | undefined
  ensureSchemaToConstraintEdge: (tableId: string, constraintId: string, columnId: string) => void
  /** 节点 data 唯一修改入口（原地刷新用，graphStore state 模块注入） */
  updateNodeData: (nodeId: string, patches: Partial<CustomNodeData>) => void
  /**
   * 连带创建引用该 Schema 的其他独立约束。
   * 仅在 ensureSchemaNode 新建 Schema 且 options.importRelatedConstraints=true 时调用。
   * 用于拖拽独立约束触发自动创建 Schema 时，补齐该 Schema 关联的其他约束。
   */
  importRelatedIndependentConstraints?: (
    tableId: string,
    excludeConstraintId: string,
    schemaPosition: { x: number; y: number }
  ) => Promise<void>
}) {
  const {
    nodes,
    edges,
    getEffectiveProjectConfigPath,
    resolveProjectRelativePath,
    ensureSchemaToConstraintEdge,
    updateNodeData,
    importRelatedIndependentConstraints,
  } = params

  /**
   * 确保指定 Schema 节点存在于画布中（幂等）。
   *
   * @param tableId - Schema 资源 ID
   * @param schemaPosition - 节点在画布上的坐标
   * @param schemaFile - 可选的预加载 Schema 文件，避免重复请求后端
   * @param options.importRelatedConstraints - 是否连带创建该 Schema 的内嵌约束和引用它的其他独立约束。
   *   拖拽独立约束触发自动创建 Schema 时置为 true；拖拽 FK 的 to_schema 等不希望雪崩的场景保持 false。
   * @param options.excludeConstraintId - 连带创建时需排除的约束 ID（通常是触发本次自动创建的被拖拽约束自身）
   */
  const ensureSchemaNode = async (
    tableId: string,
    schemaPosition: { x: number; y: number },
    schemaFile?: TableSchemaFileV2,
    options?: { importRelatedConstraints?: boolean; excludeConstraintId?: string }
  ) => {
    const found = nodes.value.find(
      (n) => n.id === tableId && (n.type === 'schema' || n.type === 'jsonSchema')
    )
    if (found) return found

    const schema = schemaFile || (await getV2Schema(tableId))
    const data = buildSchemaNodeData(
      schema,
      getEffectiveProjectConfigPath,
      resolveProjectRelativePath
    )
    const schemaNode: CustomNode = {
      id: tableId,
      type: data.sourceType === 'json' ? 'jsonSchema' : 'schema',
      position: schemaPosition,
      data: data as unknown as CustomNodeData,
    }
    addNodes(schemaNode)
    // addNodes 是 Vue Flow 增量 API，需等待 nextTick 让 model→store 回写完成后，
    // 本 tick 之后的节点查找（nodes.value.find）才能命中该节点，保证幂等语义。
    // 禁止手动 spread 追加 nodes.value——会绕过 Vue Flow 内部状态管理（见 AGENTS.md 时序约定）。
    await nextTick()

    // 连带创建该 Schema 的约束：
    // - 拖拽独立约束触发自动创建 Schema 时（options.importRelatedConstraints=true），
    //   补齐该 Schema 自身的内嵌约束 + 引用它的其他独立约束，
    //   使自动创建的 Schema 与直接拖拽 Schema 时的内容保持一致。
    // - FK 的 to_schema 等场景不传该选项，避免雪崩式导入。
    if (options?.importRelatedConstraints) {
      // 先物化内嵌约束（与直接 importSchema 行为一致）
      await materializeEmbeddedConstraints(schemaNode, schema)
      // 再连带创建引用该 Schema 的其他独立约束（排除被拖拽约束自身）
      if (importRelatedIndependentConstraints) {
        await importRelatedIndependentConstraints(
          tableId,
          options.excludeConstraintId || '',
          schemaPosition
        )
      }
    }

    return schemaNode
  }

  /**
   * 原地刷新已存在的 Schema 节点（对账 update 语义：磁盘为准，不删节点、不丢布局）。
   *
   * 三步对账：
   * 1. Schema 自身 data（columns/source 等）整体以磁盘新值替换（updateNodeData 唯一入口；
   *    shallow-merge 语义下为旧 data 独有字段补 undefined，等价整体替换）；
   * 2. 内嵌约束三态：磁盘新增 → 物化建节点；已存在且类型未变 → 原地刷新 data；
   *    磁盘已删（幽灵节点）→ 按 nodeOps 级联删除模式移除（先清派生边再删节点；
   *    约束节点无模板/转换级联，removeEdges + removeNodes 即完整级联）；
   *    类型已变（如 NotNull→Range，node type 是节点级字段无法原地改）→ 删旧建新；
   * 3. 内嵌约束的派生边先全清再按磁盘重建（边完全由 schema 内容派生，可安全重建；
   *    列引用变更时旧边会悬挂，重建保证一致）。
   */
  const refreshSchemaNode = async (schemaNodeId: string): Promise<string> => {
    const schemaFile = await getV2Schema(schemaNodeId)
    let schemaNode = nodes.value.find(
      (n) => n.id === schemaNodeId && (n.type === 'schema' || n.type === 'jsonSchema')
    )
    if (!schemaNode) {
      logger.warn(`[schema.ts] refreshSchemaNode: 节点 ${schemaNodeId} 不存在，跳过刷新`)
      return schemaNodeId
    }

    // Schema data（磁盘新值，翻转检测与整体替换共用）
    const newData = buildSchemaNodeData(
      schemaFile,
      getEffectiveProjectConfigPath,
      resolveProjectRelativePath
    )

    // 类型翻转（source 换成/离开 .json → schema↔jsonSchema）：node.type 是节点级字段
    // 无法原地改，且保存侧按 node.type 选择序列化路径——保位删旧建新（同 regex/
    // constraint 的类型翻转处理）。翻转时顺带清 schema 的全部出边（内嵌派生边），
    // 后续三态对齐按新节点重建。
    const detectedType = newData.sourceType === 'json' ? 'jsonSchema' : 'schema'
    if (schemaNode.type !== detectedType) {
      logger.info(
        `[schema.ts] refreshSchemaNode: 类型翻转 ${schemaNode.type} → ${detectedType}（保位删旧建新）: ${schemaNodeId}`
      )
      const preservedPosition = { ...schemaNode.position }
      for (const edge of edges.value.filter((e) => e.source === schemaNodeId)) {
        removeEdges(edge.id)
      }
      removeNodes([schemaNodeId])
      addNodes({
        id: schemaNodeId,
        type: detectedType,
        position: preservedPosition,
        data: newData as unknown as CustomNodeData,
      })
      await nextTick()
      schemaNode =
        nodes.value.find(
          (n) => n.id === schemaNodeId && (n.type === 'schema' || n.type === 'jsonSchema')
        ) ?? schemaNode
    }

    // 画布上属于该 Schema 的内嵌约束节点（确定性 id 前缀 + embedded 标志双重认定；
    // 独立约束 id 如 notnull_users_email 不带 schemaId 前缀，不会被误伤）
    const oldEmbedded = nodes.value.filter(
      (n) =>
        n.id.startsWith(`${schemaNodeId}_`) &&
        nodeDataGet(n.data, 'embedded') === true &&
        isConstraintNodeType(n.type ?? '')
    )
    const oldEmbeddedIds = new Set(oldEmbedded.map((n) => n.id))
    const diskEmbeddedIds = new Set(
      (Array.isArray(schemaFile.constraints) ? schemaFile.constraints : [])
        .map((item) => (item?.id ? embeddedConstraintNodeId(schemaNodeId, String(item.id)) : ''))
        .filter(Boolean)
    )

    // 派生边先清（schema→内嵌约束）：后续物化/刷新按磁盘重建
    const derivedEdges = edges.value.filter(
      (e) => e.source === schemaNodeId && oldEmbeddedIds.has(e.target)
    )
    for (const edge of derivedEdges) {
      removeEdges(edge.id)
    }

    // 幽灵节点：磁盘已不存在的内嵌约束 → 移除（派生边已清，删节点即完整清理）
    for (const ghost of oldEmbedded) {
      if (!diskEmbeddedIds.has(ghost.id)) {
        logger.info(`[schema.ts] refreshSchemaNode: 移除幽灵内嵌约束节点 ${ghost.id}`)
        removeNodes([ghost.id])
      }
    }

    // Schema data 整体替换（翻转分支刚建的新节点再 patch 一次同值，幂等无害）
    const patch: Record<string, unknown> = { ...newData }
    for (const key of nodeDataKeys(schemaNode.data)) {
      if (!(key in patch)) patch[key] = undefined
    }
    updateNodeData(schemaNodeId, patch as Partial<CustomNodeData>)

    // 物化 + 原地刷新内嵌约束（新增物化 / 已存在且类型未变则刷新 data 并重建边）
    materializeV2EmbeddedConstraints({
      schemaNode,
      schemaTableName: String(newData.tableName || schemaNodeId),
      embeddedConstraints: Array.isArray(schemaFile.constraints) ? schemaFile.constraints : [],
      columnTree: schemaFile.columns,
      hasNode: (id: string) => nodes.value.some((n) => n.id === id),
      addNode: (node: CustomNode) => {
        addNodes(node)
      },
      addConstraintEdge: ensureSchemaToConstraintEdge,
      // 刷新支持（可选回调，仅对账刷新路径传入）：已存在且类型未变 → 原地刷新；类型已变 → 删旧建新
      getNode: (id: string) => {
        const found = nodes.value.find((n) => n.id === id)
        if (!found) return undefined
        return { id: found.id, type: found.type, position: found.position, data: found.data }
      },
      updateNodeData: (id: string, data: Record<string, unknown>) =>
        updateNodeData(id, data as Partial<CustomNodeData>),
      removeNode: (id: string) => {
        removeNodes([id])
      },
    })

    await nextTick()
    return schemaNodeId
  }

  const materializeEmbeddedConstraints = async (
    schemaNode: CustomNode,
    schemaFile: TableSchemaFileV2
  ) => {
    const schemaData = schemaNode.data as SchemaNodeData
    const embedded = Array.isArray(schemaFile.constraints) ? schemaFile.constraints : []
    materializeV2EmbeddedConstraints({
      schemaNode,
      schemaTableName: schemaData.tableName,
      embeddedConstraints: embedded,
      // V2 文件的原始列树：嵌套子列按「父.子」全限定路径精确解析
      columnTree: schemaFile.columns,
      hasNode: (id: string) => nodes.value.some((n) => n.id === id),
      addNode: (node: CustomNode) => {
        // 只走 addNodes 增量 API，禁止手动 spread 追加 nodes.value
        // （会绕过 Vue Flow 内部状态管理，见 AGENTS.md Vue Flow 操作规范）
        addNodes(node)
      },
      addConstraintEdge: ensureSchemaToConstraintEdge,
    })
    // addNodes 是增量 API，store ref 的回写在 nextTick 才完成；
    // 物化后等待一拍，调用方（导入编排 / 批次重排）随后通过 nodes.value 查找新节点才可见
    await nextTick()
  }

  const importSchema = async (
    resourceId: string,
    position: { x: number; y: number }
  ): Promise<string> => {
    const schemaFile = await getV2Schema(resourceId)
    // 直接拖拽 Schema 保持原有行为：只物化内嵌约束，不连带创建引用它的独立约束。
    // 连带创建独立约束的能力（importRelatedConstraints）仅用于拖拽独立约束触发
    // 自动创建 Schema 的场景，避免改变直接拖拽 Schema 的导入范围。
    const node = await ensureSchemaNode(resourceId, position, schemaFile)
    await materializeEmbeddedConstraints(node, schemaFile)
    return node.id
  }

  return { ensureSchemaNode, materializeEmbeddedConstraints, importSchema, refreshSchemaNode }
}
