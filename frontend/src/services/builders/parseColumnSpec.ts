/**
 * @file parseColumnSpec.ts
 * @description ColumnSpecV2 反序列化的单一事实源
 *
 * 将后端 V2 schema 配置中的列定义（ColumnSpecV2）解析为前端列对象（JsonSchemaColumn）。
 *
 * 解决的对齐问题：
 * 1. Expr / Extracted 对象类型在主解析路径中丢失（Bug 1）—— 本模块统一还原
 * 2. 多条解析路径实现不一致（Bug 5）—— 5 处调用点统一收敛到本模块
 * 3. JSON 列 dataType 非法值（Bug 3）—— 由调用方传入 isJsonSchema 决定类型映射器，
 *    避免 fromBackendType().toLowerCase() 产生 JsonDataType 范围外的值
 *
 * 设计说明：
 * - isJsonSchema 由调用方根据数据源文件扩展名（.json/.jsonl/.ndjson）决定，
 *   而非按列的 json_path/children 启发式判断，避免根级标量列误判
 * - JSON 节点的所有列（含无 json_path 的根级标量列）统一走 fromJsonBackendType
 * - 普通节点的所有列走 fromBackendType
 * - 返回类型为 JsonSchemaColumn[]（与既有调用点类型一致，避免大规模类型重构）；
 *   普通节点的 data.columns 类型声明虽为 SchemaColumn[]，但 JsonSchemaColumn 是
 *   SchemaColumn 的超集，运行时安全
 */

import type { JsonSchemaColumn } from '@/types/graph'
import type { ColumnSpecV2 } from '@/types/projectV2'
import { fromBackendType, fromJsonBackendType } from '@/services/builders/schemaBuilder'
import { logger } from '@/core/utils/logger'

/**
 * 解析列类型对象（Expr / Extracted）为前端列字段，写入 colResult。
 *
 * 这段逻辑原仅存在于已停用的 hydrateSchemas.ts，此处下沉为公共能力，
 * 确保所有解析路径都能正确还原 Expr/Extracted 配置，避免 round-trip 数据丢失。
 */
function applyComplexType(
  col: ColumnSpecV2,
  colResult: JsonSchemaColumn & Record<string, unknown>,
  isJsonSchema: boolean
): void {
  if (typeof col.type !== 'object' || col.type === null) return

  const typeObj = col.type as Record<string, unknown>
  const typeName = typeObj.name

  // Expr 类型：还原绑定的 pattern / registry
  if (typeName === 'Expr') {
    if (isJsonSchema) {
      // JSON schema 类型系统（JsonObject/Array/Null/string/number/boolean）不含 Expr，
      // 降级处理：保留 dataType 为 string，记录 warn。boundPattern 仍尝试还原以便回写。
      logger.warn(`[parseColumnSpec] JSON schema 列 ${col.name} 出现 Expr 类型，降级为 string`)
    }
    colResult.boundRegistry = typeof typeObj.registry === 'string' ? typeObj.registry : undefined
    colResult.boundPattern = typeof typeObj.pattern === 'string' ? typeObj.pattern : undefined
    colResult.isBound = !!typeObj.pattern
    colResult.expressionType = typeObj.pattern ? 'explicit' : 'implicit'
    return
  }

  // Extracted 类型：还原提取配置
  if (typeName === 'Extracted') {
    colResult.extractedConfig = {
      sourceColumn: typeof typeObj.source_column === 'string' ? typeObj.source_column : '',
      extractKey: typeof typeObj.extract_key === 'string' ? typeObj.extract_key : '',
      resultType: typeof typeObj.result_type === 'string' ? typeObj.result_type : undefined,
    }
  }
}

/**
 * 将后端 ColumnSpecV2 列表解析为前端列对象（递归处理嵌套 children）。
 *
 * @param columns 后端列定义（ColumnSpecV2[]）
 * @param options.isJsonSchema 是否为 JSON schema（决定类型映射器）
 * @returns 前端列对象列表（JsonSchemaColumn[]）
 */
export function parseColumnSpecs(
  columns: ColumnSpecV2[] | undefined,
  options: { isJsonSchema: boolean }
): JsonSchemaColumn[] {
  const { isJsonSchema } = options

  const convert = (cols: ColumnSpecV2[] | undefined): JsonSchemaColumn[] => {
    return (cols || []).map((col) => {
      // 类型映射：JSON 节点统一用 fromJsonBackendType，普通节点用 fromBackendType。
      // 注意不再用 fromBackendType().toLowerCase() 强转 —— 那会让 Expression 列产生
      // 不在 JsonDataType 范围内的 'expression' 值。
      const dataType = (
        isJsonSchema ? fromJsonBackendType(col.type) : fromBackendType(col.type)
      ) as JsonSchemaColumn['dataType']

      const colResult: JsonSchemaColumn & Record<string, unknown> = {
        id: col.id,
        columnName: col.name,
        dataType,
        jsonPath: col.json_path || '',
        nullable: col.nullable,
        primaryKey: col.primary_key,
        validationErrors: [],
        constraints: {},
      }

      // 还原 Expr / Extracted 对象类型配置（修复 round-trip 数据丢失）
      applyComplexType(col, colResult, isJsonSchema)

      // 递归处理嵌套子列（JSON 树形结构）
      if (col.children && col.children.length > 0) {
        colResult.children = convert(col.children)
        colResult.isExpanded = col.expand ?? false
      }

      return colResult as JsonSchemaColumn
    })
  }

  return convert(columns)
}
