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
 * 校验错误导航组合式函数
 *
 * 将验证错误列表中的条目定位到对应的画布节点（三级定位）：
 * - L1 表级：仅 table_id → 聚焦选中 schema 节点
 * - L2 列级：有 column/column_id → L1 + 展开检查器面板 + 滚动高亮对应列
 * - L3 行级：row_index + source_file → 数据预览仅渲染前 N 行样本（usePreviewDisplay
 *   的 previewRows = data.slice(0, displayRows)，默认 5 行），全量行号在预览中不存在，
 *   行级滚动高亮不可行 → 按降级规则实现为 L2
 * 列匹配失败（schema 已改、列名对不上）静默降级 L1，不弹提示。
 * 节点不存在时尝试通过 V2 导入逻辑创建；存在时直接聚焦 + 居中。
 */
import { ref } from 'vue'
import { useGraphStore } from '@/stores/graphStore'
import { logger } from '@/core/utils/logger'
import { eventBus } from '@/core/eventBus'
import { findNode, VueFlowApiNotInitializedError } from '@/services/canvas/vueFlowApi'
import { pendingErrorColumnFocus } from '@/services/validation/errorColumnFocus'
import type { FullValidationErrorItem } from '@/api/projectValidationApi'

/** 导航结果：located 是否定位成功；created 是否自动创建了画布节点；tableName 创建节点的表名（toast 用） */
export interface NavigationOutcome {
  located: boolean
  created: boolean
  tableName?: string
}

/** @returns navigateErrorToCanvas / focusNode / resolveErrorNodeId / locatedErrorKeys 等导航方法 */
export function useValidationErrorNavigator() {
  const graphStore = useGraphStore()

  // 已定位成功的错误行 key 集合：挂在组件实例生命周期上，
  // 由调用方在新校验结果产出时调 clearLocatedErrors 清空
  const locatedErrorKeys = ref(new Set<string>())

  const markErrorLocated = (key: string) => {
    locatedErrorKeys.value.add(key)
  }

  const clearLocatedErrors = () => {
    locatedErrorKeys.value.clear()
  }

  /**
   * L2 列级定位：请求检查器面板展开并滚动高亮对应列。
   * column_id（列机器 ID）优先，column（显示名）兜底；两者皆空则不触发（L1）。
   */
  function requestColumnFocus(nodeId: string, error: FullValidationErrorItem): void {
    const columnId = error.column_id || undefined
    const columnName = error.column || undefined
    if (!columnId && !columnName) return
    const request = { nodeId, columnId, columnName }
    // 先写信箱（覆盖重挂载/异步加载时序），再发事件（直达已挂载的同节点检查器）
    pendingErrorColumnFocus.value = request
    eventBus.emit('expand-inspector-panel')
    eventBus.emit('inspector-focus-column', request)
  }

  /**
   * 将验证错误定位到画布节点（三级定位入口）
   * 如果节点不存在，尝试创建（复用 V2 导入逻辑）
   */
  async function navigateErrorToCanvas(error: FullValidationErrorItem): Promise<NavigationOutcome> {
    const nodeId = resolveErrorNodeId(error)
    if (!nodeId) {
      logger.warn('[ValidationErrorNavigator] 无法解析错误对应的节点:', error)
      return { located: false, created: false }
    }

    // 检查节点是否已在画布上
    const existingNode = graphStore.nodes.find((n) => n.id === nodeId)

    if (existingNode) {
      // 节点存在，直接聚焦 + 列级锚点（L2，列信息缺失/不匹配时检查器侧静默降级 L1）
      focusNode(nodeId)
      requestColumnFocus(nodeId, error)
      return { located: true, created: false }
    }

    const resourceInfo = resolveErrorResource(error)
    if (!resourceInfo) {
      logger.warn('[ValidationErrorNavigator] 无法从错误信息推断资源:', error)
      return { located: false, created: false }
    }

    try {
      const position = calculateImportPosition()
      const createdId = await graphStore.importV2ResourceToCanvas(
        resourceInfo.kind,
        resourceInfo.resourceId,
        position
      )
      if (createdId) {
        focusNode(createdId)
        requestColumnFocus(createdId, error)
        return { located: true, created: true, tableName: error.table || createdId }
      }
      logger.warn('[ValidationErrorNavigator] 节点创建失败')
      return { located: false, created: false }
    } catch (err) {
      logger.error('[ValidationErrorNavigator] 自动创建节点异常:', err)
      return { located: false, created: false }
    }
  }

  /**
   * 查找错误对应的画布节点 ID
   */
  function resolveErrorNodeId(error: FullValidationErrorItem): string | null {
    // 优先使用 table_id
    if (error.table_id) {
      return error.table_id
    }

    // 尝试从 table 名称匹配
    if (error.table) {
      const node = graphStore.nodes.find((n) => {
        const data = n.data as Record<string, unknown> | undefined
        return data?.tableName === error.table || data?.configName === error.table
      })
      if (node) {
        return node.id
      }
    }

    // 尝试从 source_file 推断
    if (error.source_file) {
      const fileName = error.source_file.split(/[\\/]/).pop()
      if (fileName) {
        const node = graphStore.nodes.find((n) => {
          const data = n.data as Record<string, unknown> | undefined
          const source = data?.source as { path?: string } | undefined
          const sourcePath = String(source?.path || data?.sourcePath || '')
          return sourcePath.includes(fileName)
        })
        if (node) {
          return node.id
        }
      }
    }

    return null
  }

  /**
   * 聚焦到指定节点
   */
  function focusNode(nodeId: string): void {
    // 先选中节点（store 选中驱动 inspector 跟随）
    graphStore.setSelectedNode(nodeId)

    // 同步 Vue Flow 选中态（单选语义）：VF 的 node.selected 才产生画布 .selected 高亮。
    // 必须先清掉其余 VF 选中节点——否则 VF 侧呈多选，VF→Store 同步会把单选焦点
    // 覆写为 null，inspector 落空（"节点高亮了但面板空白"的双模型不一致）。
    try {
      for (const n of graphStore.nodes) {
        if (n.id === nodeId) continue
        const other = findNode(n.id)
        if (other?.selected) {
          other.selected = false
        }
      }
      const vfNode = findNode(nodeId)
      if (vfNode && !vfNode.selected) {
        vfNode.selected = true
      }
    } catch (error) {
      // 画布未挂载（vueFlowApi 未初始化）时跳过 VF 侧同步，仅保留 store 选中
      if (!(error instanceof VueFlowApiNotInitializedError)) {
        throw error
      }
    }

    // 触发画布聚焦事件
    eventBus.emit('focus-canvas-nodes', { nodeIds: [nodeId] })
  }

  function resolveErrorResource(
    error: FullValidationErrorItem
  ): { kind: 'schema' | 'constraint' | 'regex'; resourceId: string } | null {
    if (error.table_id) {
      return { kind: 'schema', resourceId: error.table_id }
    }
    return null
  }

  function calculateImportPosition(): { x: number; y: number } {
    const allNodes = graphStore.nodes
    if (allNodes.length === 0) {
      return { x: 200, y: 200 }
    }
    const sumX = allNodes.reduce((acc, n) => acc + n.position.x, 0)
    const sumY = allNodes.reduce((acc, n) => acc + n.position.y, 0)
    return { x: sumX / allNodes.length + 300, y: sumY / allNodes.length }
  }

  return {
    navigateErrorToCanvas,
    resolveErrorNodeId,
    focusNode,
    locatedErrorKeys,
    markErrorLocated,
    clearLocatedErrors,
  }
}
