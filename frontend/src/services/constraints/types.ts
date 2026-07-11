/**
 * @file types.ts
 * @description 约束节点前端类型定义
 *
 * 定义约束节点在前端的类型系统，包括约束种类（ConstraintKind）、
 * 约束节点类型（ConstraintNodeType）以及它们在 Vue Flow 中的 handle 配置。
 *
 * 功能概述：
 * - ConstraintKind: 业务层面的约束分类（notNull、unique、foreignKey 等）
 * - ConstraintNodeType: Vue Flow 节点类型标识（notNullConstraint、uniqueConstraint 等）
 * - HandleConfig: 定义约束节点的输入/输出连接点配置
 * - 类型映射：提供 constraintKindToNodeType、nodeTypeToConstraintKind 等转换函数
 *
 * 架构设计：
 * - 与后端 ConstraintTypeV2 保持对应关系
 * - 与 types/constraints.ts 中的节点数据类型互补
 * - handle 配置决定约束节点在画布上的连接行为
 */

import type { Edge, Node } from '@vue-flow/core'
import type { ConstraintTypeV2 } from '@/types/projectV2'
import type { AnyRecord } from '@/types/utility'
import type { LocalizedMessage } from '@/services/i18n/localizedMessage'

export type ConstraintKind =
  | 'notNull'
  | 'unique'
  | 'foreignKey'
  | 'allowedValues'
  | 'range'
  | 'conditional'
  | 'scripted'
  | 'charset'
  | 'dateLogic'
  | 'composite'

export type ConstraintNodeType =
  | 'notNullConstraint'
  | 'uniqueConstraint'
  | 'foreignKeyConstraint'
  | 'allowedValuesConstraint'
  | 'rangeConstraint'
  | 'conditionalConstraint'
  | 'scriptedConstraint'
  | 'charsetConstraint'
  | 'dateLogicConstraint'
  | 'compositeConstraint'

export interface ConstraintValidationContext {
  nodes: Node[]
  schemaNode: Node
  constraintNode: Node
  edge: Edge
  columnId: string
  columnName: string
  sourceFilePath?: string
  sourceFile?: string
  sheetName?: string
  headerRow?: number
  /** 目标列在 Schema 中声明的数据类型（如 String/Integer/Decimal） */
  columnDataType?: string
  /** JSON 数据源特有选项 */
  jsonPath?: string
  recordPath?: string
  jsonFormat?: string
  /** 行内数据行（来自 TransformOutput / ManualData 等非文件数据源） */
  inlineRows?: string[][]
  /** 行内数据列名（提供时 rows 全部视为数据行，不再将第一行视为表头） */
  inlineColumnNames?: string[]
}

export interface ConstraintValidationResult {
  status: 'idle' | 'pass' | 'error' | 'missing'
  /** 错误消息（字符串形式，历史字段）。渲染端优先读 localizedErrors，缺省时回退本字段。 */
  validationErrors: string[]
  /**
   * 错误消息（key 化形式，i18n 治理新增）。
   * 渲染端应优先用 localizedErrors 经 renderText 解析；未提供时回退 validationErrors 字符串。
   * 当前为可选过渡字段：各 handler 逐步迁移填充，待全部渲染点切换后可废弃 validationErrors。
   */
  localizedErrors?: LocalizedMessage[]
  lastValidation?: {
    totalRows: number
    errorCount: number
    matchCount: number
  }
}

export interface ConstraintValidationHandler {
  kind: ConstraintKind
  validate: (ctx: ConstraintValidationContext) => Promise<ConstraintValidationResult>
  resetOnDisconnect: (nodeData: AnyRecord) => AnyRecord
}

export interface ConstraintTypeMeta {
  nodeType: ConstraintNodeType
  kind: ConstraintKind
  v2Type: ConstraintTypeV2
  requireInputHandle: boolean
}
