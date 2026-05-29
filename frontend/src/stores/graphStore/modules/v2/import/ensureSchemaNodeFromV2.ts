/**
 * @file ensureSchemaNodeFromV2.ts
 * @description V2 Schema 节点确保模块
 *
 * 提供幂等函数 ensureSchemaNodeFromV2，用于确保画布中存在指定 ID 的 Schema 节点。
 * 若节点已存在则直接返回；若不存在则从 V2 配置加载并创建。
 *
 * 核心功能：
 * - 从后端加载 Schema 定义（getV2Schema）
 * - 解析列类型、数据源路径（绝对/相对文件）
 * - 创建完整的 SchemaNodeData 并添加到画布
 *
 * 使用场景：
 * - 约束/正则导入时自动确保依赖的 Schema 节点存在
 * - 上下文感知导入时预创建关联的 Schema 节点
 */

import type { Ref } from 'vue'
import type { CustomNode, SchemaNodeData } from '@/types/graph'
import { getV2Schema } from '@/api/projectV2Api'
import { fromBackendType } from '@/services/builders'
import { normalizePath } from '@/core/utils/pathNormalization'
import { addNodes } from '@/services/canvas/vueFlowApi'

export function createEnsureSchemaNodeFromV2(params: {
  nodes: Ref<CustomNode[]>
  getEffectiveProjectConfigPath: () => string | undefined
  resolveProjectRelativePath: (
    configDir: string | undefined,
    relPath: string | undefined
  ) => string | undefined
}) {
  const { nodes, getEffectiveProjectConfigPath, resolveProjectRelativePath } = params

  async function ensureSchemaNodeFromV2(tableId: string, position: { x: number; y: number }) {
    const existing = nodes.value.find((n) => n.id === tableId && n.type === 'schema')
    if (existing) return existing

    const schema = await getV2Schema(tableId)
    const cols = (schema.columns || []).map((col) => ({
      id: col.id,
      columnName: col.name,
      dataType: fromBackendType(col.type),
      validationErrors: [],
      constraints: {},
    }))

    const configPath = getEffectiveProjectConfigPath()
    // 默认回退为 relative_file，防止后端返回的 mode 为空或未声明时 localPath 丢失
    const sourcePathMode = schema.source?.mode || 'relative_file'
    const rawLocalPath =
      sourcePathMode === 'absolute_file'
        ? schema.source?.path
        : sourcePathMode === 'relative_file'
          ? resolveProjectRelativePath(configPath, schema.source?.path)
          : undefined
    const localPath = rawLocalPath ? normalizePath(rawLocalPath) : undefined
    const sourceMode = 'localfile'

    // 优先读取 source.sheet，兼容顶层 sheet 字段（后端 TableSchemaFile 支持两者）
    const sheetName = schema.source?.sheet ?? schema.sheet

    const node: CustomNode = {
      id: tableId,
      type: 'schema',
      position,
      data: {
        configName: `Schema_${schema.name}`,
        tableName: schema.name,
        sheetName,
        sourceFilePath: schema.source?.path,
        headerRow: schema.source?.header_row ?? 0,
        sourcePathMode,
        sourceMode,
        localPath,
        columns: cols,
        saveState: 'saved',
      } as SchemaNodeData,
    }

    addNodes(node)
    return node
  }

  return { ensureSchemaNodeFromV2 }
}
