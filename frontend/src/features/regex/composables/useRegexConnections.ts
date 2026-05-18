/**
 * @file useRegexConnections.ts
 * @description 正则连接处理
 * 负责正则节点的连接处理逻辑
 * 管理正则节点与 Schema 节点之间的连接建立和断开
 */

import { logger } from '@/core/utils/logger'
import { useGraphStore } from '@/stores/graphStore'
import type { RegexNodeData } from '@/features/regex/types'

/**
 * 正则连接处理
 * 管理正则节点与数据源（Schema 节点）之间的连接逻辑
 * 提供连接的建立、断开和查询功能
 *
 * @param props - 组件属性，包含节点 ID 和数据
 * @param emit - Vue 的 emit 函数，用于向上层组件通知事件
 * @returns 包含连接处理方法的对象
 */
export function useRegexConnections(props: { id: string; data: RegexNodeData }, emit: any) {
  // 获取全局图存储，用于访问和修改节点数据
  const store = useGraphStore()

  /**
   * 处理 Schema 连接
   * 当用户从 Schema 节点的列连接到正则节点时调用
   *
   * 处理流程：
   * 1. 查找指定列
   * 2. 更新正则节点数据，设置数据源信息
   * 3. 通知父组件连接已建立
   *
   * @param schemaNode - Schema 节点对象
   * @param columnId - 要连接的列 ID
   */
  const handleSchemaConnection = (schemaNode: any, columnId: string) => {
    // 记录连接开始的日志
    logger.debug('🔄 Schema连接:', schemaNode.id, columnId)

    // 在 Schema 节点的 columns 数组中查找对应的列定义
    const column = schemaNode.data.columns.find((col: any) => col.id === columnId)

    // 如果未找到对应列，记录错误日志并返回
    if (!column) {
      logger.error('列不存在:', columnId)
      return
    }

    // 构建更新后的数据对象
    const updatedData = {
      ...props.data,
      sourceNodeId: schemaNode.id, // 设置数据源节点 ID
      sourceColumnName: column.columnName, // 设置数据源列名
    }

    // 更新节点数据
    store.updateNodeData(props.id, updatedData)

    // 派发连接成功事件，通知父组件
    emit('schemaConnected', {
      nodeId: props.id, // 正则节点 ID
      schemaNodeId: schemaNode.id, // Schema 节点 ID
      columnId: columnId, // 列 ID
      columnName: column.columnName, // 列名
    })

    // 记录连接成功的日志
    logger.debug('✅ Schema连接成功:', column.columnName)
  }

  /**
   * 断开 Schema 连接
   * 当用户断开正则节点与 Schema 节点的连接时调用
   *
   * 处理流程：
   * 1. 清除数据源信息
   * 2. 更新节点数据
   * 3. 通知父组件连接已断开
   */
  const disconnectSchema = () => {
    // 记录断开连接的日志
    logger.debug('🔄 断开Schema连接')

    // 构建更新后的数据对象，清除数据源信息
    const updatedData = {
      ...props.data,
      sourceNodeId: undefined, // 清除数据源节点 ID
      sourceColumnName: undefined, // 清除数据源列名
    }

    // 更新节点数据
    store.updateNodeData(props.id, updatedData)

    // 派发连接断开事件，通知父组件
    emit('schemaDisconnected', {
      nodeId: props.id, // 正则节点 ID
    })

    // 记录连接已断开的日志
    logger.debug('✅ Schema连接已断开')
  }

  /**
   * 获取连接的 Schema 节点
   * 根据节点数据中的 sourceNodeId 查找对应的 Schema 节点
   *
   * @returns Schema 节点对象，如果未连接则返回 null
   */
  const getConnectedSchemaNode = () => {
    // 检查是否有数据源节点 ID
    if (!props.data.sourceNodeId) {
      return null // 未连接数据源
    }

    // 在 store 的 nodes 数组中查找对应的 Schema 节点
    return store.nodes.find((node) => node.id === props.data.sourceNodeId)
  }

  /**
   * 获取连接的列信息
   * 在连接的 Schema 节点中查找对应的列定义
   *
   * @returns 列信息对象，如果未找到则返回 null
   */
  const getConnectedColumnInfo = () => {
    // 先获取连接的 Schema 节点
    const schemaNode = getConnectedSchemaNode()

    // 如果未找到 Schema 节点，返回 null
    if (!schemaNode) {
      return null
    }

    // 获取 Schema 节点的数据
    const schemaData = schemaNode.data as unknown as Record<string, unknown>
    // 在 Schema 的 columns 数组中查找对应的列
    const column = (schemaData.columns as unknown[] | undefined)?.find(
      (col) => (col as Record<string, unknown>).columnName === props.data.sourceColumnName
    )

    // 返回列信息
    return column
  }

  return {
    handleSchemaConnection,
    disconnectSchema,
    getConnectedSchemaNode,
    getConnectedColumnInfo,
  }
}
