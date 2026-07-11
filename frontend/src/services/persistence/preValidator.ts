/**
 * @fileoverview Pre-Validator
 *
 * 保存前校验：检查必填字段、引用完整性、数据源存在性、格式有效性。
 * 返回 BLOCKER/WARNING/INFO 三级错误，由 Orchestrator 决定是否阻断保存。
 */

import type { CustomNode } from '@/types/graph'
import type { ConstraintFileV2 } from '@/types/projectV2'
import type { SavePlan, PreValidationError, ValidationSeverity } from './types'

/**
 * 构造带 i18n key 的 PreValidationError。
 * message 保留作兜底；messageKey/params 供 UI 层按当前 locale 渲染。
 */
function locError(
  base: Omit<PreValidationError, 'messageKey' | 'params'>,
  messageKey: string,
  params?: Record<string, unknown>
): PreValidationError {
  return { ...base, messageKey, params }
}

export interface PreValidatorOptions {
  /** BLOCKER 是否阻断保存（默认 true） */
  blockOnError?: boolean
  /** 是否启用自动修复（默认 true） */
  autoFix?: boolean
}

/**
 * 自动修复记录
 */
export interface FixRecord {
  nodeId: string
  field: string
  description: string
}

/**
 * 预校验器
 *
 * 支持自动修复（autoFix）的可修复场景：
 * - 列名重复 → 自动加后缀
 * - 列 ID 缺失 → 生成默认 ID
 * - 列类型缺失 → 默认 Str
 * - Range min > max → 交换
 */
export class PreValidator {
  private errors: PreValidationError[] = []
  private fixRecords: FixRecord[] = []

  constructor(
    private plan: SavePlan,
    private nodes: CustomNode[],
    private options: PreValidatorOptions = {}
  ) {}

  /**
   * 执行全部校验
   */
  validate(): PreValidationError[] {
    this.errors = []
    this.fixRecords = []

    this.validateSchemas()
    this.validateConstraints()
    this.validateRegexes()
    this.validateTransforms()
    this.validateTemplateInstances()

    return this.errors
  }

  /**
   * 执行自动修复并返回修复记录
   *
   * 注意：只修改 plan，不修改原始 nodes。
   * 调用方需在保存成功后自行同步 nodes。
   */
  applyAutoFixes(): FixRecord[] {
    const autoFixEnabled = this.options.autoFix !== false
    if (!autoFixEnabled) return []

    this.fixRecords = []

    for (const error of this.errors) {
      if (error.autoFix) {
        try {
          error.autoFix()
          this.fixRecords.push({
            nodeId: error.nodeId,
            field: error.field || 'unknown',
            description: error.message,
          })
        } catch (err) {
          // autoFix 失败不阻断，记录日志即可
          console.warn(`[PreValidator] autoFix 失败: ${error.message}`, err)
        }
      }
    }

    const result = [...this.fixRecords]

    // 修复后重新校验，确保没有新的错误
    this.validate()

    return result
  }

  /**
   * 获取修复记录
   */
  getFixRecords(): FixRecord[] {
    return [...this.fixRecords]
  }

  /**
   * 获取指定级别的错误数量
   */
  count(severity: ValidationSeverity): number {
    return this.errors.filter((e) => e.severity === severity).length
  }

  /**
   * 是否存在 BLOCKER 级别错误
   */
  hasBlocker(): boolean {
    return this.errors.some((e) => e.severity === 'BLOCKER')
  }

  private addError(error: PreValidationError): void {
    this.errors.push(error)
  }

  // ============================================================================
  // Schema 校验
  // ============================================================================

  private validateSchemas(): void {
    for (const [schemaId, plan] of this.plan.schemas) {
      const schemaFile = plan.schemaFile

      // 数据源路径
      if (!schemaFile.source?.path) {
        this.addError(
          locError(
            {
              severity: 'BLOCKER',
              nodeId: schemaId,
              message: 'Schema 缺少数据源路径',
              field: 'source.path',
            },
            'validation.save.schemaMissingSource'
          )
        )
      }

      // 列完整性
      const columns = schemaFile.columns || []
      if (columns.length === 0) {
        this.addError(
          locError(
            {
              severity: 'WARNING',
              nodeId: schemaId,
              message: 'Schema 未定义任何列',
              field: 'columns',
            },
            'validation.save.schemaNoColumns'
          )
        )
      }

      const columnIds = new Set<string>()
      const columnNames = new Set<string>()
      for (let i = 0; i < columns.length; i++) {
        const col = columns[i]
        if (!col) continue
        const indexPrefix = `columns[${i}]`

        if (!col.id || String(col.id).trim() === '') {
          const suggestedId = this.suggestColumnId(col.name || `col_${i}`)
          this.addError(
            locError(
              {
                severity: 'BLOCKER',
                nodeId: schemaId,
                message: `第 ${i + 1} 列缺少 ID，建议: ${suggestedId}`,
                field: `${indexPrefix}.id`,
                autoFix: () => {
                  col.id = suggestedId
                },
              },
              'validation.save.columnMissingId',
              { index: i + 1, suggestedId }
            )
          )
        }
        if (!col.name || String(col.name).trim() === '') {
          const suggestedName = col.id ? String(col.id) : `未命名列_${i}`
          this.addError(
            locError(
              {
                severity: 'BLOCKER',
                nodeId: schemaId,
                message: `第 ${i + 1} 列缺少名称，建议: ${suggestedName}`,
                field: `${indexPrefix}.name`,
                autoFix: () => {
                  col.name = suggestedName
                },
              },
              'validation.save.columnMissingName',
              { index: i + 1, suggestedName }
            )
          )
        }
        if (!col.type || String(col.type).trim() === '') {
          const colLabel = col.name || col.id || String(i + 1)
          this.addError(
            locError(
              {
                severity: 'WARNING',
                nodeId: schemaId,
                message: `列 "${colLabel}" 未指定数据类型，已默认设为 Str`,
                field: `${indexPrefix}.type`,
                autoFix: () => {
                  col.type = 'Str'
                },
              },
              'validation.save.columnMissingType',
              { column: colLabel }
            )
          )
        }

        if (col.id && columnIds.has(col.id)) {
          const newId = this.suggestUniqueId(col.id, columnIds)
          this.addError(
            locError(
              {
                severity: 'BLOCKER',
                nodeId: schemaId,
                message: `列 ID 重复: ${col.id}，已修正为: ${newId}`,
                field: `${indexPrefix}.id`,
                autoFix: () => {
                  col.id = newId
                },
              },
              'validation.save.columnIdDuplicate',
              { oldId: col.id, newId }
            )
          )
        }
        if (col.name && columnNames.has(col.name)) {
          const newName = this.suggestUniqueName(col.name, columnNames)
          this.addError(
            locError(
              {
                severity: 'BLOCKER',
                nodeId: schemaId,
                message: `列名重复: ${col.name}，已修正为: ${newName}`,
                field: `${indexPrefix}.name`,
                autoFix: () => {
                  col.name = newName
                },
              },
              'validation.save.columnNameDuplicate',
              { oldName: col.name, newName }
            )
          )
        }
        if (col.id) columnIds.add(col.id)
        if (col.name) columnNames.add(col.name)
      }
    }
  }

  /**
   * 生成建议的列 ID（基于列名）
   */
  private suggestColumnId(baseName: string): string {
    return (
      baseName
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .substring(0, 30) || 'col'
    )
  }

  /**
   * 生成唯一的列 ID
   */
  private suggestUniqueId(baseId: string, existing: Set<string>): string {
    let counter = 1
    let candidate = `${baseId}_${counter}`
    while (existing.has(candidate)) {
      counter++
      candidate = `${baseId}_${counter}`
    }
    return candidate
  }

  /**
   * 生成唯一的列名
   */
  private suggestUniqueName(baseName: string, existing: Set<string>): string {
    let counter = 1
    let candidate = `${baseName}_${counter}`
    while (existing.has(candidate)) {
      counter++
      candidate = `${baseName}_${counter}`
    }
    return candidate
  }

  // ============================================================================
  // Constraint 校验
  // ============================================================================

  private validateConstraints(): void {
    for (const [constraintId, file] of this.plan.constraints) {
      // 通用引用校验（除 Composite 外都需要 table_id）
      if (file.type !== 'ForeignKey' && file.type !== 'Composite') {
        const tableId = file.refs?.table_id as string | undefined
        if (!tableId) {
          this.addError(
            locError(
              {
                severity: 'BLOCKER',
                nodeId: constraintId,
                message: `约束 ${file.type} 缺少 table_id 引用`,
                field: 'refs.table_id',
              },
              'validation.save.constraintMissingTableId',
              { type: file.type }
            )
          )
        } else if (!this.plan.schemas.has(tableId)) {
          this.addError(
            locError(
              {
                severity: 'WARNING',
                nodeId: constraintId,
                message: `约束引用的 schema ${tableId} 不在当前保存计划中`,
                field: 'refs.table_id',
              },
              'validation.save.constraintSchemaNotInPlan',
              { tableId }
            )
          )
        }
      }

      // ForeignKey 专用校验
      if (file.type === 'ForeignKey') {
        const { from_table_id, to_table_id, from_column_id, to_column_id } = file.refs || {}
        if (!from_table_id || !to_table_id) {
          this.addError(
            locError(
              {
                severity: 'BLOCKER',
                nodeId: constraintId,
                message: 'ForeignKey 约束缺少 from_table_id 或 to_table_id',
                field: 'refs',
              },
              'validation.save.foreignKeyMissingTableRefs'
            )
          )
        }
        if (!from_column_id || !to_column_id) {
          this.addError(
            locError(
              {
                severity: 'BLOCKER',
                nodeId: constraintId,
                message: 'ForeignKey 约束缺少 from_column_id 或 to_column_id',
                field: 'refs',
              },
              'validation.save.foreignKeyMissingColumnRefs'
            )
          )
        }
        if (from_table_id === to_table_id && from_column_id === to_column_id) {
          this.addError(
            locError(
              {
                severity: 'INFO',
                nodeId: constraintId,
                message: 'ForeignKey 自引用（from 和 to 指向同一列），请确认这是预期行为',
                field: 'refs',
              },
              'validation.save.foreignKeySelfReference'
            )
          )
        }
      }

      // Composite 专用校验
      if (file.type === 'Composite') {
        this.validateCompositeConstraint(constraintId, file)
      }

      // Range 专用校验
      if (file.type === 'Range') {
        const min = file.params?.min
        const max = file.params?.max
        if (min !== undefined && max !== undefined && Number(min) > Number(max)) {
          this.addError(
            locError(
              {
                severity: 'BLOCKER',
                nodeId: constraintId,
                message: `Range 约束 min (${min}) 大于 max (${max})，已自动交换`,
                field: 'params.min',
                autoFix: () => {
                  const params = file.params as Record<string, unknown>
                  params.max = min
                  params.min = max
                },
              },
              'validation.save.rangeMinGreaterThanMax',
              { min: String(min), max: String(max) }
            )
          )
        }
      }

      // AllowedValues 专用校验
      if (file.type === 'AllowedValues') {
        const allowed = file.params?.allowed_values as unknown[] | undefined
        if (!allowed || allowed.length === 0) {
          this.addError(
            locError(
              {
                severity: 'WARNING',
                nodeId: constraintId,
                message: 'AllowedValues 约束未配置任何允许值',
                field: 'params.allowed_values',
              },
              'validation.save.allowedValuesEmpty'
            )
          )
        }
      }

      // Scripted 专用校验
      if (file.type === 'Scripted') {
        const expr = file.params?.expression as string | undefined
        if (!expr || String(expr).trim() === '') {
          this.addError(
            locError(
              {
                severity: 'WARNING',
                nodeId: constraintId,
                message: 'Scripted 约束表达式为空',
                field: 'params.expression',
              },
              'validation.save.scriptedExpressionEmpty'
            )
          )
        }
      }
    }
  }

  /**
   * Composite 约束循环引用检测
   */
  private validateCompositeConstraint(constraintId: string, file: ConstraintFileV2): void {
    const subConstraints = Array.isArray(file.params?.sub_constraints)
      ? (file.params.sub_constraints as Array<{ id?: string }>)
      : []
    if (subConstraints.length === 0) {
      this.addError(
        locError(
          {
            severity: 'WARNING',
            nodeId: constraintId,
            message: 'Composite 约束未包含任何子约束',
            field: 'params.sub_constraints',
          },
          'validation.save.compositeNoSubConstraints'
        )
      )
      return
    }

    // 检测直接自引用（Composite 包含自身）
    const selfRef = subConstraints.find((sub) => sub.id === constraintId)
    if (selfRef) {
      this.addError(
        locError(
          {
            severity: 'BLOCKER',
            nodeId: constraintId,
            message: 'Composite 约束不能包含自身（循环引用）',
            field: 'params.sub_constraints',
          },
          'validation.save.compositeSelfReference'
        )
      )
    }

    // 检测子约束是否存在
    for (const sub of subConstraints) {
      if (!sub.id) {
        this.addError(
          locError(
            {
              severity: 'WARNING',
              nodeId: constraintId,
              message: 'Composite 包含一个缺少 ID 的子约束',
              field: 'params.sub_constraints',
            },
            'validation.save.compositeSubConstraintMissingId'
          )
        )
      }
    }
  }

  // ============================================================================
  // Regex 校验
  // ============================================================================

  private validateRegexes(): void {
    for (const [regexId, file] of this.plan.regexes) {
      if (!file.pattern && !file.uses_pattern) {
        this.addError(
          locError(
            {
              severity: 'BLOCKER',
              nodeId: regexId,
              message: 'Regex 节点必须配置 pattern 或 uses_pattern',
              field: 'pattern',
            },
            'validation.save.regexMissingPattern'
          )
        )
      }

      if (file.pattern) {
        // 正则语法校验
        try {
          new RegExp(file.pattern)
        } catch {
          this.addError(
            locError(
              {
                severity: 'BLOCKER',
                nodeId: regexId,
                message: `Regex 语法无效: ${file.pattern}`,
                field: 'pattern',
              },
              'validation.save.regexSyntaxInvalid',
              { pattern: file.pattern }
            )
          )
        }
      }

      if (file.source_ref?.table_id && !this.plan.schemas.has(file.source_ref.table_id)) {
        this.addError(
          locError(
            {
              severity: 'WARNING',
              nodeId: regexId,
              message: `Regex 引用的 schema ${file.source_ref.table_id} 不在当前保存计划中`,
              field: 'source_ref.table_id',
            },
            'validation.save.regexSchemaNotInPlan',
            { tableId: file.source_ref.table_id }
          )
        )
      }
    }
  }

  // ============================================================================
  // Transform 校验
  // ============================================================================

  private validateTransforms(): void {
    for (const [transformId, file] of this.plan.transforms) {
      if (!file.output_columns || file.output_columns.length === 0) {
        this.addError(
          locError(
            {
              severity: 'INFO',
              nodeId: transformId,
              message: 'Transform 未配置输出列',
              field: 'output_columns',
            },
            'validation.save.transformNoOutputColumns'
          )
        )
      }

      // input_from_node 引用校验
      if (file.input_from_node && !this.plan.schemas.has(file.input_from_node)) {
        // input_from_node 可能指向 transform 节点（链式转换），这里仅检查 schema
        // 更严格的检查需要遍历所有 transform，当前版本只给 INFO
        this.addError(
          locError(
            {
              severity: 'INFO',
              nodeId: transformId,
              message: `Transform 引用的输入节点 ${file.input_from_node} 不在当前 schema 集合中（可能是 transform 链式引用）`,
              field: 'input_from_node',
            },
            'validation.save.transformInputNotInSchemas',
            { nodeId: file.input_from_node }
          )
        )
      }
    }
  }

  // ============================================================================
  // TemplateInstance 校验
  // ============================================================================

  private validateTemplateInstances(): void {
    for (const [instanceId, ref] of this.plan.templateInstances) {
      if (!ref.template_id) {
        this.addError(
          locError(
            {
              severity: 'BLOCKER',
              nodeId: instanceId,
              message: 'TemplateInstance 缺少 template_id',
              field: 'template_id',
            },
            'validation.save.templateInstanceMissingId'
          )
        )
      }
    }
  }
}
