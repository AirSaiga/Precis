/**
 * @file useJsonSchemaData.ts
 * @description JSON Schema 节点数据管理组合式函数
 *
 * 底层通用 CRUD 已提取至 useSchemaDataBase，本文件保留 JSON 专属扩展：
 * - 递归列查找（嵌套 children）
 * - 子列增删改
 * - 展开/折叠树形结构
 * - 批量更新与验证
 */

import type { JsonSchemaNodeData, JsonSchemaColumn } from '../types'
import { useSchemaDataBase } from '../shared/useSchemaDataBase'

export function useJsonSchemaData(props: { id: string; data: JsonSchemaNodeData }, emit: any) {
  const findColumnRecursive = (
    columns: JsonSchemaColumn[],
    columnId: string
  ): { column: JsonSchemaColumn; parentArray: JsonSchemaColumn[]; index: number } | null => {
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i]
      if (!col) continue
      if (col.id === columnId) {
        return { column: col, parentArray: columns, index: i }
      }
      if (col.children && col.children.length > 0) {
        const result = findColumnRecursive(col.children, columnId)
        if (result) {
          return result
        }
      }
    }
    return null
  }

  const base = useSchemaDataBase<JsonSchemaColumn, JsonSchemaNodeData>(props, emit, {
    findColumn: findColumnRecursive,
  })

  const addChildColumn = (parentId: string, column: JsonSchemaColumn) => {
    const parentResult = findColumnRecursive(base.schemaData.columns, parentId)
    if (parentResult) {
      if (!parentResult.column.children) {
        parentResult.column.children = []
      }
      parentResult.column.children.push(column)
      if (!parentResult.column.isExpanded) {
        parentResult.column.isExpanded = true
      }
      base.notifyDataChanged()
    }
  }

  const updateChildColumn = (
    parentId: string,
    childId: string,
    updates: Partial<JsonSchemaColumn>
  ) => {
    const parentResult = findColumnRecursive(base.schemaData.columns, parentId)
    if (parentResult && parentResult.column.children) {
      const childResult = findColumnRecursive(parentResult.column.children, childId)
      if (childResult) {
        Object.assign(childResult.column, updates)
        base.notifyDataChanged()
      }
    }
  }

  const deleteChildColumn = (parentId: string, childId: string) => {
    const parentResult = findColumnRecursive(base.schemaData.columns, parentId)
    if (parentResult && parentResult.column.children) {
      const childIndex = parentResult.column.children.findIndex((c) => c.id === childId)
      if (childIndex !== -1) {
        parentResult.column.children.splice(childIndex, 1)
        base.notifyDataChanged()
      }
    }
  }

  const toggleColumnExpansion = (columnId: string) => {
    const result = findColumnRecursive(base.schemaData.columns, columnId)
    if (result) {
      result.column.isExpanded = !result.column.isExpanded
      base.notifyDataChanged()
    }
  }

  const batchUpdateColumns = (newColumns: JsonSchemaColumn[]) => {
    base.schemaData.columns = newColumns as unknown as typeof base.schemaData.columns
    base.notifyDataChanged()
  }

  const expandAll = () => {
    const setExpanded = (columns: JsonSchemaColumn[]) => {
      columns.forEach((col) => {
        col.isExpanded = true
        if (col.children && col.children.length > 0) {
          setExpanded(col.children)
        }
      })
    }
    setExpanded(base.schemaData.columns)
    base.notifyDataChanged()
  }

  const collapseAll = () => {
    const setCollapsed = (columns: JsonSchemaColumn[]) => {
      columns.forEach((col) => {
        col.isExpanded = false
        if (col.children && col.children.length > 0) {
          setCollapsed(col.children)
        }
      })
    }
    setCollapsed(base.schemaData.columns)
    base.notifyDataChanged()
  }

  const getColumnPath = (columnId: string): string[] => {
    const path: string[] = []

    const findPath = (
      columns: JsonSchemaColumn[],
      targetId: string,
      currentPath: string[]
    ): boolean => {
      for (const col of columns) {
        const newPath = [...currentPath, col.columnName]
        if (col.id === targetId) {
          path.push(...newPath)
          return true
        }
        if (col.children && col.children.length > 0) {
          if (findPath(col.children, targetId, newPath)) {
            return true
          }
        }
      }
      return false
    }

    findPath(base.schemaData.columns, columnId, [])
    return path
  }

  const validateData = (): { valid: boolean; errors: string[] } => {
    const errors: string[] = []

    if (!base.schemaData.columns || base.schemaData.columns.length === 0) {
      errors.push('没有定义任何字段')
    }

    const checkDuplicateNames = (columns: JsonSchemaColumn[], parentPath: string) => {
      const names = columns.map((col) => col.columnName)
      const duplicates = names.filter((name, index) => names.indexOf(name) !== index)
      if (duplicates.length > 0) {
        errors.push(
          `路径 ${parentPath || '根'} 下存在重复的字段名: ${[...new Set(duplicates)].join(', ')}`
        )
      }
      columns.forEach((col) => {
        if (col.children && col.children.length > 0) {
          const childPath = parentPath ? `${parentPath}.${col.columnName}` : col.columnName
          checkDuplicateNames(col.children, childPath)
        }
      })
    }

    checkDuplicateNames(base.schemaData.columns as JsonSchemaColumn[], '')

    return { valid: errors.length === 0, errors }
  }

  return {
    ...base,
    addChildColumn,
    updateChildColumn,
    deleteChildColumn,
    toggleColumnExpansion,
    batchUpdateColumns,
    expandAll,
    collapseAll,
    getColumnPath,
    validateData,
    findColumnRecursive,
  }
}
