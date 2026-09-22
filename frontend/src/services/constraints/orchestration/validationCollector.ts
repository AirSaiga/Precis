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
 * @file validationCollector.ts
 * @description 约束收集器 - 从图中收集约束信息
 *
 * 该模块负责从 Vue Flow 图中提取约束相关信息：
 * - 获取 SchemaNode 关联的数据源信息
 *
 * @module validationCollector
 */

import type { Edge, Node } from '@vue-flow/core'

/**
 * SchemaNode 数据源信息接口
 * 描述 SchemaNode 关联的数据源详细信息
 */
export interface SchemaNodeSourceInfo {
  /** 数据源文件的完整路径（可能是展示名或 UUID） */
  sourceFilePath: string
  /** 数据源显示名称（用于判断是否显式连接） */
  sourceFile?: string
  /** Excel 工作表名称（可选） */
  sheetName?: string
  /** 数据源预览节点的 ID（可选） */
  sourceNodeId?: string
  /** 表头行号（可选，默认为 0） */
  headerRow?: number
  /** 数据来源模式：localfile */
  sourceMode?: 'localfile'
  /** 本地文件路径（Electron 环境专用，为真实路径） */
  localPath?: string
}

/**
 * 获取指定 SchemaNode 关联的数据源信息（画布校验的"是否已连接数据源"单一事实源）
 *
 * 仅认可画布上的真实连接（两种等价形态）：
 * 1. Schema 节点 data.sourceNodeId 指向现存的 sourcePreview/jsonSourcePreview 节点；
 * 2. 存在 数据源节点 → Schema 的入边（兼容旧连接方式，manualData 亦合法）。
 *
 * 未连接时一律返回 null——Schema 缓存的 sourceFilePath/localPath（V2 导入/
 * 历史连接写入，供保存 round-trip 与后端 CLI 校验使用）不作为画布校验依据。
 *
 * @param schemaNodeId - SchemaNode 的节点 ID
 * @param nodes - 图中所有节点的数组
 * @param edges - 图中所有边的数组
 * @returns 数据源信息对象，未连接数据源时返回 null
 */
export function getSchemaNodeSourceInfo(
  schemaNodeId: string,
  nodes: Node[],
  edges: Edge[]
): SchemaNodeSourceInfo | null {
  const schemaNode = nodes.find(
    (n) => n.id === schemaNodeId && (n.type === 'schema' || n.type === 'jsonSchema')
  )
  const schemaData = schemaNode?.data as Record<string, unknown>
  const schemaSourceNodeId = schemaData?.sourceNodeId as string | undefined

  // 通过 SourcePreview 节点查找数据源（兼容 sourceNodeId 引用与入边两种连接方式）
  let sourcePreviewNode: Node | undefined

  if (schemaSourceNodeId) {
    sourcePreviewNode = nodes.find(
      (n) =>
        n.id === schemaSourceNodeId &&
        (n.type === 'sourcePreview' || n.type === 'jsonSourcePreview')
    )
    // Bug 2.1 防护：sourceNodeId 指向的节点已不存在（被删除或边已断开）时，
    // 不回退到 Schema 缓存路径——否则会基于 stale 数据继续校验。
  }

  if (!sourcePreviewNode && !schemaSourceNodeId) {
    // 无 sourceNodeId：通过入边查找（旧连接方式）。
    // §2.3: 一个 Schema 允许多数据源（manualData + sourcePreview 并连是合法场景），
    // 取边按源类型优先级 sourcePreview > jsonSourcePreview > manualData，同优先级取
    // 数组尾部（最近创建）——原实现取第一条入边，校验用哪个源纯粹取决于建边先后，
    // 先连 manualData 时甚至因源类型不匹配而整表跳过校验
    const sourceTypePriority: Record<string, number> = {
      sourcePreview: 3,
      jsonSourcePreview: 2,
      manualData: 1,
    }
    const candidates = edges
      .filter(
        (edge) =>
          edge.target === schemaNodeId &&
          (edge.targetHandle === undefined || edge.targetHandle === 'target-left')
      )
      .map((edge) => nodes.find((n) => n.id === edge.source))
      .filter((n): n is Node => !!n && !!sourceTypePriority[n.type ?? ''])

    let incomingSource: Node | undefined
    for (const candidate of candidates) {
      // 同优先级保留后者（数组靠后=最近创建）
      if (
        !incomingSource ||
        (sourceTypePriority[candidate.type ?? ''] ?? 0) >=
          (sourceTypePriority[incomingSource.type ?? ''] ?? 0)
      ) {
        incomingSource = candidate
      }
    }

    if (!incomingSource) {
      // 既无 sourceNodeId 也无入边：Schema 在画布上未连接任何数据源，返回 null（不校验）。
      // V2 导入/历史连接残留的缓存路径（sourceFilePath/localPath，用于保存 round-trip 与
      // 后端 CLI 校验）不作为画布校验依据——否则"无源"Schema 会基于 stale 路径产生
      // 幽灵 pass/fail（数据误判红线）。画布校验的唯一前置条件是真实连线。
      return null
    }

    sourcePreviewNode = incomingSource
  }

  // 有 sourceNodeId 但对应节点不可达（被删除/边已断开）：视为未连接
  if (!sourcePreviewNode) {
    return null
  }

  const sourceData = (sourcePreviewNode.data as Record<string, unknown>) || {}

  return {
    sourceFilePath: (sourceData.localPath as string | undefined) || '',
    sourceFile:
      (sourceData.sourceName as string | undefined) ||
      (sourceData.fileName as string | undefined) ||
      '',
    sheetName: sourceData.currentSheet as string | undefined,
    sourceNodeId: sourcePreviewNode.id,
    headerRow: sourceData.headerRow as number | undefined,
    sourceMode: sourceData.sourceMode as 'localfile' | undefined,
    localPath: sourceData.localPath as string | undefined,
  }
}
