/**
 * @file types/index.ts
 * @description 节点类型定义
 * 集中管理所有节点相关的类型
 */

import type { SourceMode } from '@/types/datasource'

// 重新导出所有类型（排除可能冲突的类型）
export * from '@/types/nodes'
export * from '@/types/constraints'
export * from '@/features/regex/types'
export * from '@/types/common'
export * from '@/types/datasource'
export * from '@/types/drag'

// ========== 连接相关类型 ==========

/**
 * 连接载荷
 */
export interface ConnectionPayload {
  type: string
  sourceNodeId: string
  sourceNodeName: string
  fieldName: string
  fieldIndex: number
  localPath: string
  sourceType: string
}

/**
 * 验证结果
 */
export interface ValidationResult {
  is_valid: boolean
  error_count: number
  total_rows: number
  match_count?: number
  error_rows: ValidationErrorRow[]
  validation_time: string
}

/**
 * 验证错误行
 */
export interface ValidationErrorRow {
  row_index: number
  cell_value: string
  error_message?: string
}

/**
 * 验证响应
 */
export interface ValidationResponse {
  success: boolean
  validation_type: string
  data: ValidationResult | null
  error: string | null
}

/**
 * Schema节点源信息
 * 用于约束节点获取数据源信息以执行校验
 * 包含数据源路径、模式（indexeddb/localfile）和本地路径等字段
 */
export interface SchemaNodeSourceInfo {
  sourceFilePath: string // 数据源文件路径（显示名称）
  sourceFile?: string // 数据源显示名称（用于判断是否显式连接）
  sheetName?: string // 工作表名称（Excel 场景）
  headerRow?: number // 表头行号
  sourceMode?: SourceMode // 数据来源模式：indexeddb 或 localfile
  localPath?: string // 本地文件绝对路径（Electron 环境本地文件模式专用）
}

/**
 * 约束节点数据（基础类型）
 */
export interface ConstraintNodeData {
  configName?: string
  table?: string
  column?: string
  columns?: string[]
  constraintName?: string
  validationErrors?: string[]
  validationStatus?: 'idle' | 'pass' | 'error' | 'missing'
}
