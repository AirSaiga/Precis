/**
 * @file assets.ts
 * @description 画布资产管理子模块
 *
 * 负责将当前画布上的 Schema 节点保存为可复用的资产（TableAsset），
 * 以及从资产库加载资产到画布。
 *
 * 功能概述：
 * - saveCanvasAsAsset: 将画布上的 Schema 节点序列化为 TableAsset 存入资产列表
 * - loadAssetToCanvas: 将资产列表中的 TableAsset 反序列化为 Schema 节点并添加到画布
 *
 * 架构设计：
 * - 作为 graphStore 的子模块，通过 createAssetsModule 工厂函数实例化
 * - 接收 nodes / assets / clearCanvas / createSchemaNode 等依赖注入
 * - 资产数据与画布节点双向转换，保持字段一致性
 */

import type { Ref } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import type { CustomNode, DataType, SchemaNodeData, TableAsset } from '@/types/graph'
import type { SchemaColumn } from '@/types/nodes'

/**
 * @description 创建画布资产管理模块
 * @param {Object} params - 依赖注入参数对象
 * @param {Ref<CustomNode[]>} params.nodes - 画布节点列表的响应式引用
 * @param {Ref<TableAsset[]>} params.assets - 资产列表的响应式引用
 * @param {() => void} params.clearCanvas - 清空画布的回调函数
 * @param {(position: { x: number; y: number }, name?: string) => string} params.createSchemaNode - 创建 Schema 节点的工厂函数，返回新节点 ID
 * @returns {Object} 包含 saveCanvasAsAsset 和 loadAssetToCanvas 方法的对象
 */
export function createAssetsModule(params: {
  nodes: Ref<CustomNode[]>
  assets: Ref<TableAsset[]>
  clearCanvas: () => void
  createSchemaNode: (position: { x: number; y: number }, name?: string) => string
}) {
  const { nodes, assets, clearCanvas, createSchemaNode } = params

  /**
   * @description 将当前画布上的 Schema 节点保存为资产
   * @param {string} configName - 资产的配置名称（若为空则使用节点原有名称）
   * @returns {string} 新创建资产的唯一标识符（UUID）
   * @throws {Error} 当画布上不存在 Schema 节点时抛出错误
   */
  function saveCanvasAsAsset(configName: string) {
    // 过滤出所有类型为 schema 的节点
    const schemaNodes = nodes.value.filter((n) => n.type === 'schema')
    if (schemaNodes.length === 0) {
      throw new Error('画布上未找到Schema节点')
    }

    // 目前仅支持保存第一个 Schema 节点
    const schemaNode = schemaNodes[0]
    if (!schemaNode) {
      throw new Error('画布上未找到Schema节点')
    }
    const schemaData = schemaNode.data as SchemaNodeData

    // 构造新的资产对象，只保留核心字段
    const newAsset: TableAsset = {
      id: uuidv4(),
      configName: configName || schemaData.configName,
      tableName: schemaData.tableName,
      sheetName: schemaData.sheetName,
      columns: schemaData.columns.map((col) => ({
        columnName: col.columnName,
        dataType: col.dataType,
      })),
    }

    // 将新资产追加到资产列表
    assets.value.push(newAsset)
    return newAsset.id
  }

  /**
   * @description 将指定资产加载到画布中
   * @param {string} assetId - 要加载的资产唯一标识符
   * @returns {void}
   *
   * 加载流程：
   * 1. 根据 assetId 查找资产
   * 2. 清空当前画布
   * 3. 创建新的 Schema 节点并回填资产的表名、工作表名和列定义
   */
  function loadAssetToCanvas(assetId: string) {
    // 在资产列表中查找目标资产
    const asset = assets.value.find((a) => a.id === assetId)
    if (!asset) return

    // 清空画布，避免新旧节点混杂
    clearCanvas()

    // 在固定位置创建新的 Schema 节点
    const schemaNodeId = createSchemaNode({ x: 100, y: 100 }, asset.configName)
    const schemaNode = nodes.value.find((n) => n.id === schemaNodeId)

    // 若节点创建成功，将资产数据回填到节点中
    if (schemaNode) {
      const schemaData = schemaNode.data as SchemaNodeData
      schemaData.tableName = asset.tableName
      schemaData.sheetName = asset.sheetName
      schemaData.columns = asset.columns.map((col) => ({
        id: col.columnName,
        columnName: col.columnName,
        dataType: col.dataType as DataType,
        validationErrors: [],
      })) as SchemaColumn[]
    }
  }

  return {
    saveCanvasAsAsset,
    loadAssetToCanvas,
  }
}
