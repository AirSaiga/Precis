/**
 * @file index.ts
 * @description 类型定义工具函数
 *
 * 该模块提供常用的类型转换、验证和工具函数，
 * 消除各模块中的重复类型处理逻辑。
 *
 * 功能：
 * 1. 数据类型转换（前后端映射）
 * 2. ID 清理和格式化
 * 3. 通用类型验证
 */

import type { DataType } from '@/types/graph'

/**
 * 数据类型：前端 → 后端
 *
 * 将前端 DataType 枚举转换为后端识别的类型字符串。
 *
 * @param dataType - 前端数据类型
 * @returns 后端类型标识（Str / Int / Float / Expr）
 */
export function toBackendType(dataType: DataType): string {
  switch (dataType) {
    case 'String':
      return 'Str'
    case 'Integer':
      return 'Int'
    case 'Float':
      return 'Float'
    case 'Boolean':
      return 'Str'
    case 'Date':
      return 'Str'
    case 'Expression':
      return 'Expr'
    default:
      return 'Str'
  }
}

/**
 * 数据类型：后端 → 前端
 *
 * 将后端返回的类型字符串解析为前端 DataType 枚举。
 *
 * @param typeConfig - 后端类型配置（字符串或对象）
 * @returns 前端数据类型枚举值
 */
export function fromBackendType(typeConfig: unknown): DataType {
  if (typeof typeConfig === 'string') {
    const t = typeConfig.toLowerCase()
    if (t === 'int' || t === 'integer') return 'Integer'
    if (t === 'float') return 'Float'
    if (t === 'decimal') return 'Float'
    if (t === 'str' || t === 'string') return 'String'
    if (t === 'boolean' || t === 'bool') return 'Boolean'
    if (t === 'date' || t === 'datetime' || t === 'time') return 'Date'
    if (t === 'expr' || t === 'compositeexpr') return 'Expression'
    if (t === 'jsonobject' || t === 'json_object') return 'String'
    if (t === 'jsonarray' || t === 'json_array') return 'String'
    if (t === 'jsonnull' || t === 'json_null') return 'String'
  }
  return 'String'
}

/**
 * 清理 V2 项目 ID
 *
 * 移除不安全字符（如路径分隔符、冒号、星号等），
 * 将空格替换为下划线，确保 ID 可用于文件名。
 *
 * @param input - 原始输入字符串
 * @returns 清理后的安全 ID
 */
export function sanitizeV2Id(input: string): string {
  return (input || 'project')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[\\/:"*?<>|]+/g, '_')
}

/**
 * 获取文件名（不含路径）
 *
 * @param filePath - 完整文件路径
 * @returns 文件名（含扩展名）
 */
export function getFileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath
}

/**
 * 格式化文件大小
 *
 * 将字节数转换为人类可读格式（B / KB / MB / GB）。
 *
 * @param bytes - 文件大小（字节）
 * @returns 格式化后的文件大小字符串
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

/**
 * 安全解析 JSON
 *
 * 解析失败时返回 fallback 值，避免抛出异常。
 *
 * @param json - JSON 字符串
 * @param fallback - 解析失败时的回退值
 * @returns 解析结果或 fallback
 */
export function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json)
  } catch {
    return fallback
  }
}

/**
 * 防抖函数
 *
 * 延迟执行函数，如果在延迟期间再次调用则重新计时。
 * 返回的函数附带 `cancel()` 方法，可在组件卸载时取消待执行的调用。
 *
 * @param fn - 要防抖的原始函数
 * @param delay - 延迟时间（毫秒）
 * @returns 防抖包装函数（含 cancel 方法）
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): ((...args: Parameters<T>) => void) & { cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const debounced = (...args: Parameters<T>) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), delay)
  }
  debounced.cancel = () => {
    clearTimeout(timeoutId)
    timeoutId = undefined
  }
  return debounced
}

/**
 * 节流函数
 *
 * 限制函数在指定时间间隔内最多执行一次。
 *
 * @param fn - 要节流的原始函数
 * @param limit - 时间间隔（毫秒）
 * @returns 节流包装函数
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      fn(...args)
      inThrottle = true
      setTimeout(() => (inThrottle = false), limit)
    }
  }
}

/**
 * 生成唯一 ID
 *
 * 基于时间戳和随机数生成唯一标识符。
 *
 * @param prefix - ID 前缀（默认 'id'）
 * @returns 唯一标识字符串
 */
export function generateId(prefix: string = 'id'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * 深度克隆对象
 *
 * 使用 structuredClone 实现深拷贝（注意：不处理函数、循环引用等）。
 *
 * @param obj - 要克隆的对象
 * @returns 克隆后的新对象
 */
export function deepClone<T>(obj: T): T {
  return structuredClone(obj)
}

/**
 * 检查对象是否为空
 *
 * 支持判断 null、undefined、空数组、空对象。
 *
 * @param obj - 要检查的对象
 * @returns 是否为空
 */
export function isEmpty(obj: unknown): boolean {
  if (obj === null || obj === undefined) return true
  if (Array.isArray(obj)) return obj.length === 0
  if (typeof obj === 'object') return Object.keys(obj).length === 0
  return false
}

/**
 * 标准化 source 的 (path, sheet) 元组，用于唯一性检测和索引
 *
 * 与后端 normalize_source_key 逻辑完全一致。
 *
 * @param path - 数据文件路径
 * @param sheet - Excel 工作表名（非 Excel 文件传 null）
 * @returns 标准化的 [path, sheet] 元组
 */
export function normalizeSourceKey(
  path: string,
  sheet: string | null | undefined
): [string, string | null] {
  let p = (path || '').replace(/\\/g, '/').trim().replace(/^\.\//, '')
  p = p.replace(/\/+/g, '/')
  // 模拟后端 PurePosixPath 的 .. 解析
  const driveMatch = p.match(/^[a-zA-Z]:\//)
  const prefix = driveMatch ? driveMatch[0] : ''
  const rest = prefix ? p.slice(prefix.length) : p
  const parts = rest.split('/').filter((part) => part !== '.' && part !== '')
  const resolved: string[] = []
  for (const part of parts) {
    if (part === '..') {
      resolved.pop()
    } else {
      resolved.push(part)
    }
  }
  p = prefix + resolved.join('/')
  p = p.replace(/^\.\//, '').toLowerCase()
  let s = (sheet || '').trim().toLowerCase()
  s = s || ''
  return [p, s || null]
}

export function sourceKeyString(path: string, sheet: string | null | undefined): string {
  const [p, s] = normalizeSourceKey(path, sheet)
  return s ? `${p}::${s}` : p
}
