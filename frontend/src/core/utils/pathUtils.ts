/**
 * @file pathUtils.ts
 * @description 路径处理工具函数
 *
 * 提供跨模块共享的路径标准化与解析能力
 */

/**
 * 标准化配置目录路径
 *
 * - 移除路径末尾的斜杠/反斜杠
 * - 如果路径指向文件（.csv/.xlsx/.xls/.yaml），自动提取目录部分
 * - 空路径返回 undefined，确保调用方可统一处理
 *
 * @param inputPath - 原始路径（可选）
 * @returns 标准化后的目录路径，或 undefined
 */
export function normalizeConfigDir(inputPath?: string): string {
  const raw = (inputPath || '').trim()
  if (!raw) return raw
  const withoutTrailing = raw.replace(/[\\/]+$/, '')
  if (/\.(csv|xlsx|xls|ya?ml)$/i.test(withoutTrailing)) {
    const idx = Math.max(withoutTrailing.lastIndexOf('\\'), withoutTrailing.lastIndexOf('/'))
    return idx >= 0 ? withoutTrailing.slice(0, idx) : withoutTrailing
  }
  return withoutTrailing
}
