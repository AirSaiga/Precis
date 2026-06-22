/**
 * @file useGlobalJsonSchemaOperations.ts
 * @description 全局JSON Schema操作Composable
 * 提供跨节点的全局JSON Schema操作能力
 */

import { useGraphStore } from '@/stores/graphStore'
import type { CustomNode, JsonSchemaNodeData } from '@/types/nodes'
/**
 * 全局JSON Schema操作Composable
 * 提供跨节点的全局JSON Schema操作能力
 * @returns 全局JSON Schema操作相关的方法
 */
export function useGlobalJsonSchemaOperations() {
  const store = useGraphStore()

  /**
   * 获取所有JSON Schema节点
   */
  const getAllJsonSchemaNodes = () => {
    return store.nodes.filter((node) => node.type === 'jsonSchema') as CustomNode[]
  }

  /**
   * 根据ID获取JSON Schema节点
   */
  const getJsonSchemaNodeById = (nodeId: string) => {
    return store.nodes.find((node) => node.id === nodeId && node.type === 'jsonSchema') as
      | CustomNode
      | undefined
  }

  /**
   * 获取JSON Schema节点的列定义
   */
  const getJsonSchemaColumns = (nodeId: string) => {
    const node = getJsonSchemaNodeById(nodeId)
    if (!node) return []
    return (node.data as JsonSchemaNodeData).columns || []
  }

  /**
   * 查找所有JSON Schema节点中的重复列名
   */
  const findDuplicateColumnNames = () => {
    const jsonSchemaNodes = getAllJsonSchemaNodes()
    const columnNameMap = new Map<string, Array<{ nodeId: string; nodeName: string }>>()

    for (const node of jsonSchemaNodes) {
      const nodeData = node.data as JsonSchemaNodeData
      for (const column of nodeData.columns) {
        const existing = columnNameMap.get(column.columnName) || []
        existing.push({
          nodeId: node.id,
          nodeName: nodeData.tableName,
        })
        columnNameMap.set(column.columnName, existing)
      }
    }

    const duplicates: Array<{
      columnName: string
      occurrences: Array<{ nodeId: string; nodeName: string }>
    }> = []

    for (const [columnName, occurrences] of columnNameMap) {
      if (occurrences.length > 1) {
        duplicates.push({
          columnName,
          occurrences,
        })
      }
    }

    return duplicates
  }

  /**
   * 验证JSON Schema配置
   */
  const validateJsonSchemas = () => {
    const jsonSchemaNodes = getAllJsonSchemaNodes()
    const issues: Array<{
      nodeId: string
      nodeName: string
      issue: string
      severity: 'error' | 'warning'
    }> = []

    for (const node of jsonSchemaNodes) {
      const nodeData = node.data as JsonSchemaNodeData

      if (!nodeData.tableName) {
        issues.push({
          nodeId: node.id,
          nodeName: nodeData.tableName || '未命名',
          issue: '表名为空',
          severity: 'error',
        })
      }

      if (!nodeData.columns || nodeData.columns.length === 0) {
        issues.push({
          nodeId: node.id,
          nodeName: nodeData.tableName,
          issue: '没有定义列',
          severity: 'warning',
        })
      }

      const columnNames = new Set<string>()
      for (const column of nodeData.columns || []) {
        if (columnNames.has(column.columnName)) {
          issues.push({
            nodeId: node.id,
            nodeName: nodeData.tableName,
            issue: `列名 "${column.columnName}" 重复`,
            severity: 'error',
          })
        }
        columnNames.add(column.columnName)
      }
    }

    return {
      isValid: issues.filter((i) => i.severity === 'error').length === 0,
      issues,
    }
  }

  /**
   * 批量导出JSON Schema为YAML
   */
  const exportAllToYaml = () => {
    const jsonSchemaNodes = getAllJsonSchemaNodes()
    const yamlFiles: Array<{ name: string; content: string }> = []

    for (const node of jsonSchemaNodes) {
      const nodeData = node.data as JsonSchemaNodeData
      const yamlContent = convertJsonSchemaToYaml(nodeData)
      yamlFiles.push({
        name: `${nodeData.tableName}.schema.yaml`,
        content: yamlContent,
      })
    }

    return yamlFiles
  }

  /**
   * 转换JSON Schema为YAML格式
   */
  const convertJsonSchemaToYaml = (data: JsonSchemaNodeData): string => {
    const yamlLines: string[] = []

    yamlLines.push('# JSON Schema 配置文件')
    yamlLines.push('')
    yamlLines.push('version: 2')
    yamlLines.push(`id: ${data.tableName.toLowerCase().replace(/\s+/g, '_')}`)
    yamlLines.push(`name: ${data.tableName}`)
    yamlLines.push('')
    yamlLines.push('source:')
    yamlLines.push(`  mode: ${data.sourcePathMode || 'relative_file'}`)
    if (data.sourceFile) {
      yamlLines.push(`  path: ${data.sourceFile}`)
    }
    yamlLines.push(`  format: ${data.format || 'json'}`)
    yamlLines.push('')
    yamlLines.push('columns:')

    for (const column of data.columns) {
      yamlLines.push(`  - id: ${column.id}`)
      yamlLines.push(`    name: ${column.columnName}`)
      yamlLines.push(`    jsonPath: ${column.jsonPath}`)
      yamlLines.push(`    type: ${column.dataType}`)
    }

    return yamlLines.join('\n')
  }

  /**
   * 获取JSON Schema统计信息
   */
  const getJsonSchemaStats = () => {
    const jsonSchemaNodes = getAllJsonSchemaNodes()

    let totalColumns = 0
    let totalConstraints = 0

    for (const node of jsonSchemaNodes) {
      const nodeData = node.data as JsonSchemaNodeData
      totalColumns += nodeData.columns.length

      for (const column of nodeData.columns) {
        if (column.constraints) {
          if (column.constraints.notNull) totalConstraints++
          if (column.constraints.unique) totalConstraints++
          if (column.constraints.allowedValues) totalConstraints++
        }
      }
    }

    return {
      totalNodes: jsonSchemaNodes.length,
      totalColumns,
      totalConstraints,
    }
  }

  return {
    getAllJsonSchemaNodes,
    getJsonSchemaNodeById,
    getJsonSchemaColumns,
    findDuplicateColumnNames,
    validateJsonSchemas,
    exportAllToYaml,
    convertJsonSchemaToYaml,
    getJsonSchemaStats,
  }
}
