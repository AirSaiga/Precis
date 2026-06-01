/**
 * @file types.ts
 * @description 列生成策略接口定义
 *
 * 抽象不同数据源（Excel/CSV/JSON）的列定义生成逻辑。
 * 每种数据源类型实现自己的生成策略，但对外暴露统一接口。
 */

/**
 * 双向列比较结果
 * 用于智能列填充弹窗的决策判断
 */
export interface ColumnComparisonResult {
  /** Schema 是否无列定义 */
  schemaEmpty: boolean
  /** 数据源有但 Schema 没有的列名（正向差异） */
  newInSource: string[]
  /** Schema 有但数据源没有的非衍生列名（反向差异） */
  staleInSchema: string[]
  /** 所有源列是否都存在于 Schema 中 */
  isMatch: boolean
  /** 是否需要用户介入 */
  needsAction: boolean
}

/**
 * 列生成策略接口
 *
 * 所有数据源类型的列生成器必须实现此接口。
 * 职责：从原始数据生成/更新 Schema 列定义，并支持列不匹配检测。
 */
export interface ColumnGenerationStrategy {
  /**
   * 从源数据生成列定义
   *
   * @param rawData - 源数据（类型因数据源而异：Excel/CSV 为 string[][]，JSON 为 unknown[]）
   * @param existingColumns - 现有的列定义数组
   * @returns 新生成的列定义数组
   */
  generate(rawData: unknown, existingColumns: unknown[]): unknown[]

  /**
   * 比较源字段与现有列定义
   *
   * @param sourceFields - 源数据字段名列表
   * @param existingColumns - 现有的列定义数组
   * @returns 结构化的比较结果
   */
  compare(sourceFields: string[], existingColumns: unknown[]): ColumnComparisonResult

  /**
   * 从预览数据中提取源字段列表
   *
   * @param previewData - 后端返回的预览数据
   * @returns 字段名数组，无数据时返回 undefined
   */
  extractSourceFields(previewData: Record<string, unknown>): string[] | undefined
}
