/**
 * @file useForeignKeyConnection.ts
 * @description 外键约束连接处理
 *
 * 目标：
 * - 对齐 notNull / unique 的“连接处理器”架构：将外键节点相关的连线行为集中在一个 composable 中。
 * - 让 useConnections 作为“路由层”只负责：识别连接组合、创建边样式、调用处理器写回数据。
 *
 * 覆盖的连接场景：
 * 1) Schema(列) -> ForeignKeyConstraint(输入端口)：写入 sourceRef/sourceInfo 等稳定引用
 * 2) Schema(列) -> Schema(target-left)：快捷手势创建 ForeignKeyConstraint 节点并连上源列
 * 3) ForeignKeyConstraint -> Schema(target-left)：写入 targetRef/config.targetNodeId 等参照关系
 */

import { useGraphStore } from '@/stores/graphStore'
import type {
  CustomNode,
  SchemaNodeData,
  JsonSchemaNodeData,
  ForeignKeyConstraintNodeData,
  TransformOutputNodeData,
  ManualDataNodeData,
} from '@/types/graph'
import type { Edge } from '@vue-flow/core'
import { validateForInlineSource } from '@/services/constraints/validationRegistryCore'

/**
 * 外键连接处理
 * @returns 外键连接相关的处理方法集合
 */
export function useForeignKeyConnection() {
  // 获取全局图存储，用于创建约束节点/连线及更新节点数据
  const store = useGraphStore()

  // 辅助函数：判断是否为 Schema 类型节点（支持 schema 和 jsonSchema）
  const isSchemaType = (type: string | undefined): boolean =>
    type === 'schema' || type === 'jsonSchema'

  /**
   * 尝试处理 Schema(列) -> Schema(target-left) 的快捷外键创建手势
   *
   * 设计说明：
   * - 用户从"源表列"连到"目标表左侧输入"时，仍视为创建外键约束的快捷入口；
   * - 但不强制创建 FK->Schema 的物理连线，避免目标表左侧过多外键导致拥挤；
   * - 参照关系以 FK 节点内部的 stable ref（targetRef/config.targetNodeId）为准。
   *
   * @param sourceNodeId - 源 Schema 节点 ID
   * @param targetNodeId - 目标 Schema 节点 ID
   * @param sourceHandle - 源 handle
   * @param targetHandle - 目标 handle
   * @param edgeOptions - 由路由层传入的边样式配置
   * @returns 创建成功则返回新 FK 节点 ID，否则返回 null
   */
  const handleSchemaToSchemaForeignKeyShortcutConnection = (
    sourceNodeId: string,
    targetNodeId: string,
    sourceHandle: string | undefined,
    targetHandle: string | undefined,
    edgeOptions?: Partial<Edge>
  ): string | null => {
    const sourceNode = store.nodes.find((n: CustomNode) => n.id === sourceNodeId)
    const targetNode = store.nodes.find((n: CustomNode) => n.id === targetNodeId)
    if (!sourceNode || !targetNode) return null

    // 防御性校验：只处理 Schema/JsonSchema -> Schema/JsonSchema 的 target-left 连接
    if (
      !isSchemaType(sourceNode?.type) ||
      !isSchemaType(targetNode?.type) ||
      !sourceHandle ||
      targetHandle !== 'target-left'
    ) {
      return null
    }

    // 解析列 ID
    const sourceColumnId = sourceHandle.startsWith('source-right-')
      ? sourceHandle.replace('source-right-', '')
      : null
    if (!sourceColumnId) return null

    // 读取源/目标表信息
    const sourceSchemaData = sourceNode.data as SchemaNodeData | JsonSchemaNodeData
    const targetSchemaData = targetNode.data as SchemaNodeData | JsonSchemaNodeData

    const sourceColumns = sourceSchemaData.columns || []
    const sourceColumn = sourceColumns.find((c) => c.id === sourceColumnId)
    if (!sourceColumn) return null

    const sourceTableName = sourceSchemaData.tableName
    const targetTableName = targetSchemaData.tableName
    if (!sourceTableName || !targetTableName) return null

    // 约束节点位置：放在源/目标节点的中点
    const position = {
      x: (sourceNode.position.x + targetNode.position.x) / 2,
      y: (sourceNode.position.y + targetNode.position.y) / 2,
    }

    // 创建 FK 约束节点
    const constraintNodeId = store.createConstraintNode(position, 'foreignKey', {
      sourceTable: sourceTableName,
      sourceColumn: sourceColumn.columnName,
      targetTable: targetTableName,
      targetColumn: '',
      constraintName: `FK_${sourceTableName}_${sourceColumn.columnName}`,
    })

    // 写回 FK 节点的稳定引用关系
    // 展示边由 ForeignKeyConstraintNode 自动管理（有目标表+目标列时自动创建）
    store.updateNodeData(constraintNodeId, {
      sourceRef: { nodeId: sourceNodeId, columnId: sourceColumnId },
      targetRef: { nodeId: targetNodeId },
      sourceInfo: {
        nodeId: sourceNodeId,
        label: `${sourceTableName}.${sourceColumn.columnName}`,
        column: sourceColumn.columnName,
      },
      config: {
        ruleType: 'EXIST_IN',
        targetNodeId: targetNodeId,
        targetColumn: '',
      },
    })

    // 创建 Schema(列) -> FK(输入端口) 的真实输入边
    store.createConnection(
      sourceNodeId,
      constraintNodeId,
      sourceHandle,
      `target-input-${constraintNodeId}`,
      edgeOptions
    )

    return constraintNodeId
  }

  /**
   * 处理 Schema(列) -> ForeignKeyConstraint 的连接（设置待校验字段）
   *
   * @param sourceNodeId - 源 Schema 节点 ID
   * @param targetNodeId - 目标 FK 约束节点 ID
   * @param sourceHandleId - 源 handle（列端口）
   * @param targetHandleId - 目标 handle（区分输入端口）
   */
  const isPureDataSourceType = (type: string | undefined): boolean =>
    type === 'transformOutput' || type === 'manualData'

  const handleSchemaToForeignKeyConnection = async (
    sourceNodeId: string,
    targetNodeId: string,
    sourceHandleId: string,
    targetHandleId?: string | null
  ): Promise<void> => {
    const sourceNode = store.nodes.find((n: CustomNode) => n.id === sourceNodeId)
    const targetNode = store.nodes.find((n: CustomNode) => n.id === targetNodeId)
    if (!sourceNode || !targetNode) return

    // 只处理 Schema/JsonSchema -> foreignKeyConstraint
    if (
      (!isSchemaType(sourceNode?.type) && !isPureDataSourceType(sourceNode?.type)) ||
      targetNode?.type !== 'foreignKeyConstraint'
    )
      return

    if (isPureDataSourceType(sourceNode?.type)) {
      const sourceData = sourceNode.data as TransformOutputNodeData | ManualDataNodeData
      const columnName = (sourceData.columnName as string) || 'Column1'
      const configName = (sourceData.configName as string) || columnName

      store.updateNodeData(targetNodeId, {
        ...targetNode.data,
        sourceRef: { nodeId: sourceNodeId, columnId: '0' },
        sourceTable: configName,
        sourceColumn: columnName,
        sourceInfo: {
          nodeId: sourceNodeId,
          label: configName,
          column: columnName,
        },
      })

      await validateForInlineSource({
        sourceNodeId,
        constraintNode: targetNode,
        nodes: store.nodes,
        updateNodeData: store.updateNodeData,
      })
      return
    }

    // 解析源列 ID：source-right-{columnId} -> {columnId}
    const columnId = sourceHandleId.startsWith('source-right-')
      ? sourceHandleId.replace('source-right-', '')
      : sourceHandleId

    const sourceData = sourceNode.data as SchemaNodeData | JsonSchemaNodeData
    const column = sourceData.columns.find((c) => c.id === columnId)
    if (!column) return

    // FK 节点目前只支持"输入端口"连接（待校验字段）
    // targetHandleId 格式：target-input-{fkNodeId}
    const isInputHandle = targetHandleId?.includes('target-input')
    if (!isInputHandle) return

    // 写回 FK 节点：使用稳定引用（nodeId+columnId）避免列名变更导致关联丢失
    store.updateNodeData(targetNodeId, {
      ...targetNode.data,
      sourceRef: { nodeId: sourceNodeId, columnId },
      sourceTable: sourceData.tableName,
      sourceColumn: column.columnName,
      sourceInfo: {
        nodeId: sourceNodeId,
        label: `${sourceData.tableName}.${column.columnName}`,
        column: column.columnName,
      },
    })
  }

  /**
   * 处理 ForeignKeyConstraint -> Schema(target-left) 的连接（设置参照目标表）
   *
   * @param fkNodeId - 外键约束节点 ID
   * @param targetSchemaNodeId - 参照目标 Schema 节点 ID
   * @param targetHandle - 目标 handle（预期为 target-left）
   */
  const handleForeignKeyToSchemaConnection = (
    fkNodeId: string,
    targetSchemaNodeId: string,
    targetHandle: string | undefined
  ): void => {
    const fkNode = store.nodes.find((n: CustomNode) => n.id === fkNodeId)
    const targetSchemaNode = store.nodes.find((n: CustomNode) => n.id === targetSchemaNodeId)
    if (!fkNode || !targetSchemaNode) return

    // 只处理 FK -> Schema/JsonSchema 的 target-left（把 schema 作为参照目标表）
    if (fkNode?.type !== 'foreignKeyConstraint' || !isSchemaType(targetSchemaNode?.type)) return
    if (targetHandle !== 'target-left') return

    const targetSchemaData = targetSchemaNode.data as SchemaNodeData | JsonSchemaNodeData

    // 用户手工连线 FK->Schema 设置目标表
    // 展示边由 ForeignKeyConstraintNode 自动管理（有目标表+目标列时自动创建）
    store.updateNodeData(fkNodeId, {
      targetTable: targetSchemaData?.tableName || '',
      targetRef: { nodeId: targetSchemaNodeId },
      config: {
        ruleType: 'EXIST_IN',
        ...(fkNode.data as ForeignKeyConstraintNodeData)?.config,
        targetNodeId: targetSchemaNodeId,
      },
    })
  }

  /**
   * 处理 ForeignKeyConstraint -> Schema 列（source-right-{columnId}）的连接（设置参照目标列）
   *
   * @param fkNodeId - 外键约束节点 ID
   * @param targetSchemaNodeId - 参照目标 Schema 节点 ID
   * @param targetColumnId - 目标列 ID
   * @param targetColumnName - 目标列名
   */
  const handleForeignKeyToSchemaColumnConnection = (
    fkNodeId: string,
    targetSchemaNodeId: string,
    targetColumnId: string,
    targetColumnName: string
  ): void => {
    const fkNode = store.nodes.find((n: CustomNode) => n.id === fkNodeId)
    const targetSchemaNode = store.nodes.find((n: CustomNode) => n.id === targetSchemaNodeId)
    if (!fkNode || !targetSchemaNode) return

    const targetSchemaData = targetSchemaNode.data as SchemaNodeData | JsonSchemaNodeData

    // 设置目标表和目标列
    store.updateNodeData(fkNodeId, {
      targetTable: targetSchemaData?.tableName || '',
      targetColumn: targetColumnName,
      targetRef: { nodeId: targetSchemaNodeId, columnId: targetColumnId },
      config: {
        ruleType: 'EXIST_IN',
        ...(fkNode.data as ForeignKeyConstraintNodeData)?.config,
        targetNodeId: targetSchemaNodeId,
        targetColumn: targetColumnName,
      },
    })
  }

  return {
    handleSchemaToSchemaForeignKeyShortcutConnection,
    handleSchemaToForeignKeyConnection,
    handleForeignKeyToSchemaConnection,
    handleForeignKeyToSchemaColumnConnection,
  }
}
