/**
 * @fileoverview 数据源文件类型工具模块
 *
 * 功能概述:
 * - 提供统一的数据源文件类型检测和格式化功能
 * - 集中管理文件扩展名到文件类型的映射关系
 * - 支持 CSV、Excel、JSON 等常见数据源格式
 *
 * 架构设计:
 * - 配置驱动：通过 EXTENSION_TO_TYPE_MAP 集中管理扩展名映射
 * - 纯函数设计：所有函数无副作用，易于测试和维护
 * - 类型安全：完整的 TypeScript 类型定义
 *
 * 扩展新类型示例:
 * ```typescript
 * // 只需在 EXTENSION_TO_TYPE_MAP 中添加新扩展名
 * const EXTENSION_TO_TYPE_MAP = {
 *   csv: 'csv',
 *   xlsx: 'excel',
 *   xls: 'excel',
 *   json: 'json',
 *   xml: 'xml',  // 新增
 *   yaml: 'yaml', // 新增
 * }
 * ```
 *
 * 使用示例:
 * ```typescript
 * import { detectFileTypeFromPath, isSupportedFileType } from '@/utils/fileTypeUtils'
 *
 * const type = detectFileTypeFromPath('data/users.xlsx')  // 'excel'
 * const supported = isSupportedFileType('report.csv')     // true
 * ```
 */

/**
 * 数据源文件类型
 */
export type DataSourceFileType = 'csv' | 'excel' | 'json' | 'unknown'

/**
 * 文件扩展名类型
 */
export type FileExtension = string

/**
 * 文件扩展名到文件类型的映射配置
 *
 * 扩展新类型时，只需在此对象中添加新的键值对
 */
const EXTENSION_TO_TYPE_MAP: Record<FileExtension, DataSourceFileType> = {
  csv: 'csv',
  xlsx: 'excel',
  xls: 'excel',
  json: 'json',
} as const

/**
 * 从文件扩展名检测文件类型
 *
 * @param ext - 文件扩展名（不含点号，如 'csv'、'xlsx'）
 * @returns 文件类型，如果未知则返回 'unknown'
 *
 * @example
 * detectFileTypeFromExtension('csv')    // 'csv'
 * detectFileTypeFromExtension('xlsx')   // 'excel'
 * detectFileTypeFromExtension('XML')    // 'unknown' (大小写敏感)
 */
export function detectFileTypeFromExtension(ext: string): DataSourceFileType {
  const normalizedExt = ext.toLowerCase()
  return EXTENSION_TO_TYPE_MAP[normalizedExt] || 'unknown'
}

/**
 * 从文件路径或文件名检测文件类型
 *
 * @param filePath - 文件路径或文件名（如 'data/users.xlsx'、'report.csv'）
 * @returns 文件类型，如果无法识别则返回 'unknown'
 *
 * @example
 * detectFileTypeFromPath('data/users.xlsx')  // 'excel'
 * detectFileTypeFromPath('report.CSV')       // 'csv' (大小写不敏感)
 * detectFileTypeFromPath('data.backup.json') // 'json' (取最后一个扩展名)
 * detectFileTypeFromPath('unknown.xyz')      // 'unknown'
 */
export function detectFileTypeFromPath(filePath: string): DataSourceFileType {
  if (!filePath || typeof filePath !== 'string') {
    return 'unknown'
  }

  // 提取文件名（处理路径分隔符）
  const fileName = filePath.split(/[/\\]/).pop() || filePath
  
  // 提取扩展名（取最后一个点号后的部分）
  const ext = fileName.split('.').pop()
  
  if (!ext) {
    return 'unknown'
  }

  return detectFileTypeFromExtension(ext)
}

/**
 * 获取指定文件类型支持的所有扩展名
 *
 * @param type - 文件类型
 * @returns 扩展名数组（不含点号）
 *
 * @example
 * getFileTypeExtensions('excel')  // ['xlsx', 'xls']
 * getFileTypeExtensions('csv')    // ['csv']
 * getFileTypeExtensions('json')   // ['json']
 * getFileTypeExtensions('unknown') // []
 */
export function getFileTypeExtensions(type: DataSourceFileType): string[] {
  if (type === 'unknown') {
    return []
  }

  return Object.entries(EXTENSION_TO_TYPE_MAP)
    .filter(([, fileType]) => fileType === type)
    .map(([ext]) => ext)
}

/**
 * 检查文件是否为支持的类型
 *
 * @param filePath - 文件路径或文件名
 * @returns 如果是支持的类型返回 true，否则返回 false
 *
 * @example
 * isSupportedFileType('data.xlsx')  // true
 * isSupportedFileType('report.csv') // true
 * isSupportedFileType('image.png')  // false
 * isSupportedFileType('unknown')    // false
 */
export function isSupportedFileType(filePath: string): boolean {
  const type = detectFileTypeFromPath(filePath)
  return type !== 'unknown'
}

/**
 * 获取文件类型的简短显示标签（不含国际化）
 *
 * 注意：此函数返回的是类型标识符，实际显示时应使用国际化翻译
 *
 * @param type - 文件类型
 * @returns 类型标签（大写形式）
 *
 * @example
 * formatFileTypeLabel('csv')    // 'CSV'
 * formatFileTypeLabel('excel')  // 'EXCEL'
 * formatFileTypeLabel('json')   // 'JSON'
 * formatFileTypeLabel('unknown') // 'UNKNOWN'
 */
export function formatFileTypeLabel(type: DataSourceFileType): string {
  return type.toUpperCase()
}

/**
 * 获取所有支持的文件类型列表
 *
 * @returns 文件类型数组（去重）
 *
 * @example
 * getSupportedFileTypes()  // ['csv', 'excel', 'json']
 */
export function getSupportedFileTypes(): DataSourceFileType[] {
  const types = new Set(Object.values(EXTENSION_TO_TYPE_MAP))
  types.delete('unknown')
  return Array.from(types) as DataSourceFileType[]
}
