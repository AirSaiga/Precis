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
import { ref, type Ref } from 'vue'
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
 * @param hoveredColumn - 当前悬停列 ID 的响应式引用（用于 Pattern 拖放定位目标列）
 * @returns 保存相关的方法和状态
 */
export function useJsonSchemaSaving(
  props: { id: string; data: JsonSchemaNodeData },
  emit: (event: string, ...args: unknown[]) => void,
  hoveredColumn?: Ref<string | null>
) {
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
    getTargetColumnId: () => hoveredColumn?.value ?? props.data.columns[0]?.id ?? null,
    nodeType: 'jsonSchema',
    onSaveShortcut: () => nodeSaving.handleSave(),
  })

  /**
   * 处理 JSON SourcePreviewNode 断开连接
   */
  const handleSourceNodeDisconnected = (event: CustomEvent) => {
    const { targetNodeId } = event.detail

    if (targetNodeId === props.id) {
      store.updateNodeData(props.id, {
        ...props.data,
        tableName: 'new_json_table',
        sourceFile: undefined,
        sourceFilePath: undefined,
        jsonPath: undefined,
        recordPath: undefined,
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
   * 转换为 YAML 格式(对齐后端 V2 schema 格式)
   *
   * 格式约定(与 backend ColumnSpec / ConstraintItem 一致):
   * - JSON 选项放 source.options(snake_case): json_path / record_path / format
   * - 列级 json_path(而非 jsonPath)
   * - 内嵌约束为表级 constraints 列表,每项 {id, type, column, enabled, params}
   */
  const convertToYaml = (data: JsonSchemaNodeData): string => {
    // 收集表级内嵌约束(从列上的 constraints 标记转后端 ConstraintItem 格式)
    const embeddedConstraints: Record<string, unknown>[] = []
    const walkColumnsForConstraints = (columns: JsonSchemaColumn[]) => {
      for (const col of columns) {
        if (col.constraints) {
          if (col.constraints.notNull) {
            embeddedConstraints.push({
              id: `${col.id}_notNull`,
              type: 'NotNull',
              enabled: true,
              column: col.columnName,
            })
          }
          if (col.constraints.unique) {
            embeddedConstraints.push({
              id: `${col.id}_unique`,
              type: 'Unique',
              enabled: true,
              column: col.columnName,
            })
          }
          if (
            col.constraints.allowedValues &&
            Array.isArray(col.constraints.allowedValues) &&
            col.constraints.allowedValues.length > 0
          ) {
            embeddedConstraints.push({
              id: `${col.id}_allowedValues`,
              type: 'AllowedValues',
              enabled: true,
              column: col.columnName,
              params: { allowed_values: col.constraints.allowedValues.map(String) },
            })
          }
        }
        if (col.children && col.children.length > 0) {
          walkColumnsForConstraints(col.children)
        }
      }
    }
    walkColumnsForConstraints(data.columns || [])

    // 序列化列(递归含 children,字段名对齐后端 json_path)
    const serializeColumn = (col: JsonSchemaColumn): Record<string, unknown> => {
      const spec: Record<string, unknown> = {
        id: col.id,
        name: col.columnName,
        type: col.dataType || 'string',
      }
      if (col.jsonPath) spec.json_path = col.jsonPath
      if (col.nullable === false) spec.nullable = false
      if (col.primaryKey) spec.primary_key = true
      if (col.description) spec.description = col.description
      if (col.children && col.children.length > 0) {
        spec.children = col.children.map(serializeColumn)
      }
      return spec
    }

    const schemaObj: Record<string, unknown> = {
      version: 2,
      id: (data.tableName || 'json_schema').toLowerCase().replace(/\s+/g, '_'),
      name: data.tableName || 'JsonSchema',
      source: {
        mode: data.sourcePathMode || 'relative_file',
        ...(data.sourceFile ? { path: data.sourceFile } : {}),
        options: {
          format: data.format || 'auto',
          ...(data.jsonPath ? { json_path: data.jsonPath } : {}),
          ...(data.recordPath ? { record_path: data.recordPath } : {}),
        },
      },
      columns: (data.columns || []).map(serializeColumn),
      ...(embeddedConstraints.length > 0 ? { constraints: embeddedConstraints } : {}),
    }

    return yaml.dump(schemaObj, { indent: 2, lineWidth: 120 })
  }

  /**
   * 导入 YAML 配置(对齐后端 V2 schema 格式,向后兼容旧内联格式)
   */
  const importFromYaml = async (yamlContent: string) => {
    try {
      const parsed = yaml.load(yamlContent) as Record<string, unknown> | null
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid YAML format')
      }

      const source = (parsed.source || {}) as Record<string, unknown>
      const options = (source.options || {}) as Record<string, unknown>

      // 从表级 constraints 列表(后端 ConstraintItem 格式)收集列约束标记
      // key: columnName, value: 该列的约束标记
      const constraintMarksByColumn = new Map<string, JsonSchemaColumn['constraints']>()
      const tableConstraints = parsed.constraints as unknown[] | undefined
      if (Array.isArray(tableConstraints)) {
        for (const item of tableConstraints) {
          const c = item as Record<string, unknown>
          const colName = String(c.column ?? c.columns ?? '')
          if (!colName) continue
          const type = String(c.type ?? '')
          const enabled = c.enabled !== false // 默认启用
          if (!enabled) continue
          const existing = constraintMarksByColumn.get(colName) || {}
          if (type === 'NotNull') existing.notNull = true
          else if (type === 'Unique') existing.unique = true
          else if (type === 'AllowedValues') {
            const params = (c.params || {}) as Record<string, unknown>
            const vals = params.allowed_values
            if (Array.isArray(vals)) existing.allowedValues = (vals as unknown[]).map(String)
          }
          constraintMarksByColumn.set(colName, existing)
        }
      }

      function parseColumns(raw: unknown[]): JsonSchemaColumn[] {
        if (!Array.isArray(raw)) return []
        return raw.map((col: unknown) => {
          const c = col as Record<string, unknown>
          // 兼容旧内联约束格式(列上直接 notNull/unique)与新表级约束列表
          const inlineConstraints = c.constraints as Record<string, unknown> | undefined
          const children = c.children as unknown[] | undefined
          const colName = String(c.name || c.columnName || '')

          const tableLevelConstraints = constraintMarksByColumn.get(colName)
          // 优先用表级约束标记,回退内联(向后兼容)
          const merged = tableLevelConstraints
            ? { ...tableLevelConstraints }
            : inlineConstraints
              ? {
                  notNull: !!inlineConstraints.notNull,
                  unique: !!inlineConstraints.unique,
                  allowedValues: Array.isArray(inlineConstraints.allowedValues)
                    ? (inlineConstraints.allowedValues as string[])
                    : undefined,
                }
              : undefined

          return {
            id: String(c.id || uuidv4()),
            columnName: colName,
            jsonPath: String(c.json_path ?? c.jsonPath ?? ''),
            dataType: String(c.type || c.dataType || 'string') as JsonSchemaColumn['dataType'],
            nullable: c.nullable === false ? false : undefined,
            primaryKey:
              (c.primaryKey ?? c.primary_key) == null
                ? undefined
                : !!(c.primaryKey ?? c.primary_key),
            description: c.description ? String(c.description) : undefined,
            constraints: merged,
            children: children ? parseColumns(children) : undefined,
          }
        })
      }

      const newData: Partial<JsonSchemaNodeData> = {
        tableName: String(parsed.name || parsed.tableName || props.data.tableName || 'JsonSchema'),
        sourcePathMode:
          (source.mode as 'relative_file' | 'absolute_file') || props.data.sourcePathMode,
        sourceFile: source.path ? String(source.path) : props.data.sourceFile,
        jsonPath: options.json_path
          ? String(options.json_path)
          : (source.jsonPath as string) || props.data.jsonPath,
        recordPath: options.record_path
          ? String(options.record_path)
          : (source.recordPath as string) || props.data.recordPath,
        format:
          (options.format as 'auto' | 'array' | 'lines' | 'object') ||
          (source.format as 'auto' | 'array' | 'lines' | 'object') ||
          props.data.format ||
          'auto',
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
