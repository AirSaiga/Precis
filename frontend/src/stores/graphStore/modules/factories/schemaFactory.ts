/**
 * @file schemaFactory.ts
 * @description Schema 节点工厂模块 - 负责创建和管理数据表结构节点
 *
 * ====================================================================
 * 功能概述
 * ====================================================================
 * 1. createSchemaNode: 在画布上创建新的 Schema 节点（表结构定义节点）
 * 2. addColumnToSchema: 为已有 Schema 节点添加列定义
 *
 * ====================================================================
 * 架构设计
 * ====================================================================
 * - 采用工厂模式封装节点创建逻辑
 * - 使用 createBaseNodeFactory 消除样板代码
 * - 自动设置新创建的节点为选中状态
 * - 新节点初始状态为 'draft'（草稿），需要保存后才变为 'saved'
 *
 * @module graphStore/modules/factories
 */

import type { Ref } from 'vue'
import type { CustomNode, CustomNodeData, SchemaNodeData } from '@/types/graph'
import type { SchemaColumn } from '@/types/nodes'
import { createBaseNodeFactory } from './createBaseNodeFactory'
import { i18n } from '@/i18n'

export function createSchemaFactoryModule(params: {
  nodes: Ref<CustomNode[]>
  selectedNodeId: Ref<string | null>
  updateNodeData: (nodeId: string, newData: Partial<CustomNodeData>) => void
}) {
  const { nodes, selectedNodeId, updateNodeData } = params
  const createNode = createBaseNodeFactory({ nodes, selectedNodeId })

  function createSchemaNode(
    position: { x: number; y: number },
    name?: string,
    options?: { nodeId?: string }
  ) {
    return createNode(
      'schema',
      position,
      {
        configName: name || i18n.global.t('factories.defaultName.schema'),
        tableName: 'new_table',
        sheetName: null,
        columns: [],
        saveState: 'draft',
      },
      options ? { nodeId: options.nodeId } : undefined
    )
  }

  function addColumnToSchema(schemaNodeId: string, columnName?: string, dataType?: string) {
    const schemaNode = nodes.value.find((n) => n.id === schemaNodeId && n.type === 'schema')
    if (!schemaNode) return

    const schemaData = schemaNode.data as SchemaNodeData
    const fallbackName = 'new_column'
    const newColumn = {
      id: columnName || fallbackName,
      columnName: columnName || fallbackName,
      dataType: dataType || 'String',
      validationErrors: [],
    }

    updateNodeData(schemaNodeId, {
      columns: [...schemaData.columns, newColumn as SchemaColumn],
      saveState: 'draft',
    })
  }

  return {
    createSchemaNode,
    addColumnToSchema,
  }
}
