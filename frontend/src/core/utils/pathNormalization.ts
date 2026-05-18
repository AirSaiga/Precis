/**
 * @file pathNormalization.ts
 * @description 统一路径标准化模块
 *
 * 核心设计原则：
 * - 所有路径在"进入系统边界"时立即标准化
 * - 存储层只保存标准化后的路径
 * - 比较层只比较标准化后的路径
 *
 * 标准化规则（Canonical Form）：
 * - 统一使用正斜杠 `/`
 * - 统一转换为小写（Windows 文件系统不区分大小写）
 * - 去除尾部空白和末尾斜杠（文件路径）
 * - 去除冗余的 `.` 和 `..`（未来可扩展）
 */

/**
 * 将任意路径转换为标准形式（canonical form）
 *
 * 标准化规则：
 * 1. 去除首尾空白
 * 2. 将所有反斜杠 `\` 替换为正斜杠 `/`
 * 3. 转换为小写（Windows 文件系统不区分大小写）
 * 4. 去除末尾的 `/`（文件路径）
 *
 * @param input - 原始路径
 * @returns 标准化后的路径
 */
export function normalizePath(input: string): string {
  if (!input) return ''
  return input.trim().replace(/\\/g, '/').toLowerCase().replace(/\/$/, '')
}

/**
 * 将目录路径转换为标准形式
 *
 * 与 normalizePath 的区别：保留末尾的 `/`，便于拼接相对路径
 *
 * @param input - 原始目录路径
 * @returns 标准化后的目录路径（带末尾 `/`）
 */
export function normalizeDirPath(input: string): string {
  const normalized = normalizePath(input)
  if (!normalized) return ''
  // 目录路径保留末尾斜杠，便于拼接
  return normalized + '/'
}

/**
 * 判断路径是否为绝对路径
 *
 * @param input - 路径
 * @returns true 表示绝对路径
 */
export function isAbsolutePath(input: string): boolean {
  if (!input) return false
  // Windows 绝对路径: C:\path 或 C:/path
  // Unix 绝对路径: /path
  return /^[a-zA-Z]:[\\/]/.test(input) || input.startsWith('/')
}

/**
 * 确保路径指向目录（如果指向文件则提取目录部分）
 *
 * 与 normalizePath 的区别：保留末尾的 `/`，便于拼接相对路径。
 * 如果输入已经是目录路径，确保末尾有 `/`；如果是文件路径，提取目录并加 `/`。
 *
 * @param input - 原始路径
 * @returns 目录路径（标准化后，带末尾 `/`）
 */
export function ensureDirPath(input: string): string {
  let path = input.trim()
  if (!path) return ''
  // 如果路径指向文件（常见扩展名），提取目录部分
  if (/\.(yaml|yml|csv|xlsx|xls|json)$/i.test(path)) {
    const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
    if (lastSlash >= 0) {
      path = path.substring(0, lastSlash)
    }
  }
  const normalized = normalizePath(path)
  // 确保末尾有 `/`，便于后续拼接相对路径时不会产生粘连
  return normalized ? normalized + '/' : ''
}

/**
 * 解析相对路径为绝对路径
 *
 * @param relPath - 相对路径
 * @param baseDir - 基础目录（必须是目录路径）
 * @returns 绝对路径，如果解析失败返回 undefined
 */
export function resolveRelativePath(relPath: string, baseDir: string): string | undefined {
  const base = ensureDirPath(baseDir)
  const rel = relPath.trim()
  if (!base || !rel) return undefined
  // 如果 rel 已经是绝对路径，直接标准化后返回
  if (isAbsolutePath(rel)) return normalizePath(rel)
  // 拼接路径
  const sep = '/'
  const normalizedRel = rel.replace(/\\/g, '/').replace(/^\/+/, '')
  return base + normalizedRel
}

/**
 * 获取路径的文件名部分
 *
 * @param input - 路径
 * @returns 文件名
 */
export function getPathBasename(input: string): string {
  const normalized = normalizePath(input)
  if (!normalized) return ''
  const idx = normalized.lastIndexOf('/')
  return idx >= 0 ? normalized.slice(idx + 1) : normalized
}

/**
 * 获取路径的目录名部分
 *
 * @param input - 路径
 * @returns 目录路径
 */
export function getPathDirname(input: string): string {
  const normalized = normalizePath(input)
  if (!normalized) return ''
  const idx = normalized.lastIndexOf('/')
  return idx >= 0 ? normalized.slice(0, idx) : ''
}

/**
 * 比较两个路径是否等价
 *
 * 使用标准化后的形式进行比较
 *
 * @param a - 路径 A
 * @param b - 路径 B
 * @returns true 表示等价
 */
export function arePathsEqual(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b)
}

/**
 * 数据源路径匹配策略
 */
export type PathMatchStrategy = 'canonical' | 'basename'

/**
 * 根据策略匹配数据源
 *
 * @param targetPath - 目标路径
 * @param candidatePaths - 候选路径数组（每个元素是 { fileId, localPath }）
 * @param strategy - 匹配策略
 * @returns 匹配到的索引，未找到返回 -1
 */
export function findPathMatchIndex(
  targetPath: string,
  candidatePaths: Array<{ fileId?: string; localPath?: string }>,
  strategy: PathMatchStrategy = 'canonical'
): number {
  if (strategy === 'canonical') {
    const target = normalizePath(targetPath)
    return candidatePaths.findIndex((c) => {
      return normalizePath(c.fileId || '') === target || normalizePath(c.localPath || '') === target
    })
  }

  if (strategy === 'basename') {
    const targetBase = getPathBasename(targetPath)
    return candidatePaths.findIndex((c) => {
      return (
        getPathBasename(c.fileId || '') === targetBase ||
        getPathBasename(c.localPath || '') === targetBase
      )
    })
  }

  return -1
}
