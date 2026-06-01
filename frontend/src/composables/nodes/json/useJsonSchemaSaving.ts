/**
 * @file useJsonSchemaSaving.ts
 * @description JSON Schema 节点保存逻辑
 *
 * 功能概述:
 * - 保存状态管理
 * - 保存成功/失败处理
 * - 导出为 YAML
 * - 关闭确认逻辑
 *
 * 架构设计:
 * - 使用 CustomEvent 进行跨组件通信
 * - 通过 useGraphStore 持久化节点数据
 * - 支持草稿状态的关闭确认
 */

import { logger } from '@/core/utils/logger'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { v4 as uuidv4 } from 'uuid'
import { useGraphStore } from '@/stores/graphStore'
import type { JsonSchemaColumn, JsonSchemaNodeData } from '@/types/nodes'
import yaml from 'js-yaml'
import { useNodeSaving } from '../shared/useNodeSaving'

/**
 * JSON Schema 节点保存逻辑
 *
 * @param props - 组件属性
 * @param emit - Vue 的 emit 函数
 * @returns 保存相关的方法和状态
 */
export function useJsonSchemaSaving(props: { id: string; data: JsonSchemaNodeData }, emit: any) {
  const { t } = useI18n()
  const store = useGraphStore()

  // 保存状态
  const isDirty = ref(false)

  /**
   * 标记数据为已修改
   */
  const markDirty = () => {
    isDirty.value = true
  }

  /**
   * 标记数据为已保存
   */
  const markClean = () => {
    isDirty.value = false
  }

  const nodeSaving = useNodeSaving({
    nodeId: props.id,
    nodeData: props.data,
    emit,
    eventPrefix: 'json-schema-node',
    shouldConfirmClose: () => props.data.saveState === 'draft' || isDirty.value,
    onSaveSuccess: () => {
      markClean()
      setTimeout(() => {
        nodeSaving.saveSuccess.value = false
      }, 3000)
    },
    onPatternBind: (columnId, patternData, columns) => {
      markDirty()
      return columns
    },
    addConstraint: (columnId, constraintType) => {
      const updatedColumns = props.data.columns.map((col) => {
        if (col.id === columnId) {
          return {
            ...col,
            constraints: {
              ...col.constraints,
              [constraintType]: true,
            },
          }
        }
        return col
      })

      store.updateNodeData(props.id, {
        ...props.data,
        columns: updatedColumns,
        updatedAt: new Date().toISOString(),
      })
      markDirty()
    },
    getTargetColumnId: () => (emit as any)?.columnId || props.data.columns[0]?.id,
    nodeType: 'jsonSchema',
    onSaveShortcut: () => nodeSaving.handleSave(),
  })

  /**
   * 处理 JSON SourcePreviewNode 断开连接
   */
  const handleSourceNodeDisconnected = (event: CustomEvent) => {
    const { sourceNodeId, targetNodeId } = event.detail

    if (targetNodeId === props.id) {
      store.updateNodeData(props.id, {
        ...props.data,
        tableName: 'new_json_table',
        sourceFile: null,
        sourceFilePath: null,
        jsonPath: null,
        recordPath: null,
        outputPortConnected: false,
      })
    }
  }

  /**
   * 处理 Pattern 拖拽
   */
  const handlePatternDragOver = (event: DragEvent) => {
    event.preventDefault()
    event.dataTransfer!.dropEffect = 'copy'

    const target = event.target as HTMLElement | null
    const row = target?.closest?.('.column-row') as HTMLElement | null
    const columnId = row?.dataset?.columnId
    if (columnId) {
      emit('column-hover', columnId)
    }
  }

  /**
   * 处理键盘事件
   */
  const handleKeydown = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 's') {
      event.preventDefault()
      nodeSaving.handleSave()
    }
  }

  /**
   * 导出为 YAML 文件
   */
  const exportToYaml = async () => {
    try {
      const yaml = convertToYaml(props.data)

      const blob = new Blob([yaml], { type: 'text/yaml' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${props.data.tableName || 'json_schema'}.schema.yaml`
      a.click()
      URL.revokeObjectURL(url)

      logger.debug('✅ JSON Schema 导出为 YAML 成功')
    } catch (error) {
      logger.error('导出 YAML 失败:', error)
    }
  }

  /**
   * 转换为 YAML 格式
   */
  const convertToYaml = (data: JsonSchemaNodeData): string => {
    const yamlLines: string[] = []

    yamlLines.push('# ============================================================')
    yamlLines.push('# JSON Schema 配置文件')
    yamlLines.push('# ============================================================')
    yamlLines.push('')
    yamlLines.push('version: 2')
    yamlLines.push('')
    yamlLines.push(`id: ${(data.tableName || 'json_schema').toLowerCase().replace(/\s+/g, '_')}`)
    yamlLines.push(`name: ${data.tableName || 'JsonSchema'}`)
    yamlLines.push('')
    yamlLines.push('source:')
    yamlLines.push(`  mode: ${data.sourcePathMode || 'relative_file'}`)
    if (data.sourceFile) {
      yamlLines.push(`  path: ${data.sourceFile}`)
    }
    if (data.jsonPath) {
      yamlLines.push(`  jsonPath: ${data.jsonPath}`)
    }
    if (data.recordPath) {
      yamlLines.push(`  recordPath: ${data.recordPath}`)
    }
    yamlLines.push(`  format: ${data.format || 'json'}`)
    yamlLines.push('')
    yamlLines.push('columns:')

    for (const column of data.columns || []) {
      yamlLines.push(`  - id: ${column.id}`)
      yamlLines.push(`    name: ${column.columnName}`)
      if (column.jsonPath) {
        yamlLines.push(`    jsonPath: ${column.jsonPath}`)
      }
      yamlLines.push(`    type: ${column.dataType || 'string'}`)
      if (column.nullable === false) {
        yamlLines.push(`    nullable: false`)
      }
      if (column.primaryKey) {
        yamlLines.push(`    primary_key: true`)
      }
      if (column.description) {
        yamlLines.push(`    description: "${column.description}"`)
      }

      if (column.constraints && Object.keys(column.constraints).length > 0) {
        yamlLines.push('    constraints:')
        if (column.constraints.notNull) {
          yamlLines.push('      notNull: true')
        }
        if (column.constraints.unique) {
          yamlLines.push('      unique: true')
        }
        if (column.constraints.allowedValues && column.constraints.allowedValues.length > 0) {
          yamlLines.push(`      allowedValues: [${column.constraints.allowedValues.join(', ')}]`)
        }
      }

      if (column.children && column.children.length > 0) {
        yamlLines.push('    children:')
        for (const child of column.children) {
          yamlLines.push(`      - id: ${child.id}`)
          yamlLines.push(`        name: ${child.columnName}`)
          if (child.jsonPath) {
            yamlLines.push(`        jsonPath: ${child.jsonPath}`)
          }
          yamlLines.push(`        type: ${child.dataType || 'string'}`)
        }
      }
    }

    return yamlLines.join('\n')
  }

  /**
   * 导入 YAML 配置
   */
  const importFromYaml = async (yamlContent: string) => {
    try {
      const parsed = yaml.load(yamlContent) as Record<string, unknown> | null
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid YAML format')
      }

      const source = (parsed.source || {}) as Record<string, unknown>

      function parseColumns(raw: unknown[]): JsonSchemaColumn[] {
        if (!Array.isArray(raw)) return []
        return raw.map((col: unknown) => {
          const c = col as Record<string, unknown>
          const constraints = c.constraints as Record<string, unknown> | undefined
          const children = c.children as unknown[] | undefined

          return {
            id: String(c.id || uuidv4()),
            columnName: String(c.name || c.columnName || ''),
            jsonPath: String(c.jsonPath || ''),
            dataType: String(c.type || c.dataType || 'string') as JsonSchemaColumn['dataType'],
            nullable: c.nullable === false ? false : undefined,
            primaryKey: !!c.primaryKey,
            description: c.description ? String(c.description) : undefined,
            constraints: constraints
              ? {
                  notNull: !!constraints.notNull,
                  unique: !!constraints.unique,
                  allowedValues: Array.isArray(constraints.allowedValues)
                    ? (constraints.allowedValues as string[])
                    : undefined,
                }
              : undefined,
            children: children ? parseColumns(children) : undefined,
          }
        })
      }

      const newData: Partial<JsonSchemaNodeData> = {
        tableName: String(parsed.name || parsed.tableName || props.data.tableName || 'JsonSchema'),
        sourcePathMode:
          (source.mode as 'relative_file' | 'absolute_file') || props.data.sourcePathMode,
        sourceFile: source.path ? String(source.path) : props.data.sourceFile,
        jsonPath: source.jsonPath ? String(source.jsonPath) : props.data.jsonPath,
        recordPath: source.recordPath ? String(source.recordPath) : props.data.recordPath,
        format: (source.format as 'auto' | 'array' | 'lines' | 'object') || props.data.format || 'auto',
        columns: parseColumns(parsed.columns as unknown[]),
        saveState: 'draft',
      }

      store.updateNodeData(props.id, {
        ...props.data,
        ...newData,
      })
      markDirty()
      logger.debug('YAML 配置导入成功')
      return true
    } catch (error) {
      logger.error('导入 YAML 失败:', error)
      return false
    }
  }

  return {
    // 保存状态
    isSaving: nodeSaving.isSaving,
    saveSuccess: nodeSaving.saveSuccess,
    saveError: nodeSaving.saveError,
    isDirty,
    saveBtnHovered: nodeSaving.saveBtnHovered,
    closeBtnHovered: nodeSaving.closeBtnHovered,
    nodeHovered: nodeSaving.nodeHovered,
    showCloseConfirm: nodeSaving.showCloseConfirm,

    // 保存方法
    handleSave: nodeSaving.handleSave,
    handleSaveComplete: nodeSaving.handleSaveComplete,
    handleSaveCompleteDOM: nodeSaving.handleSaveCompleteDOM,
    markDirty,
    markClean,

    // 关闭方法
    handleClose: nodeSaving.handleClose,
    confirmCloseWithoutSave: nodeSaving.confirmCloseWithoutSave,
    saveAndClose: nodeSaving.saveAndClose,
    cancelClose: nodeSaving.cancelClose,

    // 校验方法
    handleValidate: nodeSaving.handleValidate,

    // 事件处理
    handleSourceNodeDisconnected,
    handlePatternDragOver,
    handlePatternDrop: nodeSaving.handlePatternDrop,
    handleKeydown,

    // 辅助方法
    bindPatternToColumn: nodeSaving.bindPatternToColumn,
    addConstraintToColumn: nodeSaving.addConstraintToColumn,
    exportToYaml,
    importFromYaml,
  }
}
