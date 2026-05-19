/**
 * @file types.ts
 * @description Inspector 配置驱动类型定义
 *
 * 定义配置驱动属性检查器的完整类型系统：
 * - InspectorField: 字段配置（类型、标签、验证、条件显示）
 * - InspectorWhen: 条件表达式（exists/equals/not/and/or）
 * - InspectorValueSource: 值来源（data 路径或 meta 信息）
 * - InspectorConfig: 完整检查器配置（字段列表、布局、操作）
 */

export type InspectorConfigVersion = 1

export type InspectorValuePath = Array<string | number>

export type InspectorValueSource =
  | { source: 'data'; path: InspectorValuePath }
  | { source: 'meta'; key: 'nodeId' | 'nodeType' }

export type InspectorWhen =
  | { op: 'exists'; source: InspectorValueSource }
  | { op: 'equals'; source: InspectorValueSource; value: string | number | boolean | null }
  | { op: 'not'; expr: InspectorWhen }
  | { op: 'and'; exprs: InspectorWhen[] }
  | { op: 'or'; exprs: InspectorWhen[] }

export type InspectorFieldBase = {
  id: string
  labelKey: string
  helpKey?: string
  when?: InspectorWhen
  readonly?: boolean
}

export type InspectorTextField = InspectorFieldBase & {
  kind: 'text'
  source: InspectorValueSource
  placeholderKey?: string
  emptyToNull?: boolean
}

export type InspectorNumberField = InspectorFieldBase & {
  kind: 'number'
  source: InspectorValueSource
  min?: number
  max?: number
  step?: number
  emptyToNull?: boolean
}

export type InspectorBooleanField = InspectorFieldBase & {
  kind: 'boolean'
  source: InspectorValueSource
}

export type InspectorTextareaField = InspectorFieldBase & {
  kind: 'textarea'
  source: InspectorValueSource
  rows?: number
}

export type InspectorDateField = InspectorFieldBase & {
  kind: 'date'
  source: InspectorValueSource
}

export type InspectorCodeField = InspectorFieldBase & {
  kind: 'code'
  source: InspectorValueSource
  rows?: number
}

export type InspectorSelectOption =
  | { type: 'static'; options: Array<{ labelKey: string; value: string | number | boolean | null }> }
  | { type: 'dataPath'; path: InspectorValuePath; labelPath?: InspectorValuePath; valuePath?: InspectorValuePath }

export type InspectorSelectField = InspectorFieldBase & {
  kind: 'select'
  source: InspectorValueSource
  options: InspectorSelectOption
  placeholderKey?: string
}

export type InspectorPathField = InspectorFieldBase & {
  kind: 'path'
  source: InspectorValueSource
}

export type InspectorJsonField = InspectorFieldBase & {
  kind: 'json'
  source: InspectorValueSource
}

export type InspectorJsonEditorField = InspectorFieldBase & {
  kind: 'jsonEditor'
  source: InspectorValueSource
  rows?: number
  parse?: 'auto' | 'always' | 'never'
  validateType?: 'object' | 'array'
}

export type InspectorTagsField = InspectorFieldBase & {
  kind: 'tags'
  source: InspectorValueSource
  placeholderKey?: string
  editable?: boolean
}

export type InspectorReadonlyField = InspectorFieldBase & {
  kind: 'readonly'
  source: InspectorValueSource
}

export type InspectorDateReferenceTypeField = InspectorFieldBase & {
  kind: 'dateReferenceType'
  referenceDatePath: InspectorValuePath
  referenceColumnPath: InspectorValuePath
  optionDateLabelKey: string
  optionColumnLabelKey: string
}

export type InspectorForeignKeyTargetColumnField = InspectorFieldBase & {
  kind: 'foreignKeyTargetColumn'
  source: InspectorValueSource
  placeholderKey?: string
}

export type InspectorDynamicListColumn =
  | { key: string; kind: 'text'; placeholderKey?: string; width?: string }
  | { key: string; kind: 'select'; options: InspectorSelectOption; width?: string }

export type InspectorDynamicListField = InspectorFieldBase & {
  kind: 'dynamicList'
  source: InspectorValueSource
  columns: InspectorDynamicListColumn[]
  addButtonLabelKey: string
  emptyItem: Record<string, unknown>
  minItems?: number
}

export type InspectorRegexPatternField = InspectorFieldBase & {
  kind: 'regexPattern'
  source: InspectorValueSource
  placeholderKey?: string
}

export type InspectorWeightedSumField = InspectorFieldBase & {
  kind: 'weightedSum'
  source: InspectorValueSource
}

export type InspectorField =
  | InspectorTextField
  | InspectorNumberField
  | InspectorBooleanField
  | InspectorTextareaField
  | InspectorDateField
  | InspectorCodeField
  | InspectorSelectField
  | InspectorPathField
  | InspectorJsonField
  | InspectorJsonEditorField
  | InspectorTagsField
  | InspectorReadonlyField
  | InspectorDateReferenceTypeField
  | InspectorForeignKeyTargetColumnField
  | InspectorDynamicListField
  | InspectorRegexPatternField
  | InspectorWeightedSumField

export type InspectorCommitPayload = unknown | { __patch: Record<string, unknown> }

export type InspectorSection = {
  id: string
  titleKey?: string
  descriptionKey?: string
  when?: InspectorWhen
  fields: InspectorField[]
}

export type InspectorConfigV1 = {
  version: InspectorConfigVersion
  nodeType: string
  titleKey?: string
  sections: InspectorSection[]
}

export function isInspectorConfigV1(value: unknown): value is InspectorConfigV1 {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (v.version !== 1) return false
  if (typeof v.nodeType !== 'string') return false
  if (!Array.isArray(v.sections)) return false
  return true
}
