/**
 * @file capabilities/fileApi.ts
 * @description 文件操作能力抽象层（扩展版）
 *
 * 设计目标：
 * - 在 core/utils/fileApi.ts 的基础上，为业务层提供更高层的文件能力接口。
 * - 未来所有业务代码统一从本文件导入文件相关能力，逐步替代 core/utils/fileApi.ts。
 * - 当前保留 core/utils/fileApi.ts 作为底层实现，避免一次性改动过大。
 */

export {
  getFileDownloadUrl,
  readFile,
  writeFile,
  checkFileExists,
  scanDirectory,
  makeDirectory,
  uploadFile,
} from '@/core/utils/fileApi'

import { isElectron } from '@/core/utils/electronDetector'
import { scanDirectory, uploadFile } from '@/core/utils/fileApi'
import { logger } from '@/core/utils/logger'

export interface ResolvedFileReference {
  /** 后端可访问的文件路径 */
  path: string
  /** 原始文件名 */
  name: string
  /** 文件大小（字节） */
  size: number
}

/**
 * 将浏览器 File 对象解析为后端可访问的路径。
 *
 * Electron 模式下，File 对象通常带有本地绝对路径（path 属性），直接复用即可；
 * Web 模式下，需要将文件上传到后端临时目录并返回临时路径。
 */
export async function resolveFileReference(file: File): Promise<ResolvedFileReference> {
  if (isElectron()) {
    const electronFile = file as File & { path?: string }
    return {
      path: electronFile.path || file.name,
      name: file.name,
      size: file.size,
    }
  }

  const result = await uploadFile(file)
  return {
    path: result.temp_path,
    name: result.original_name,
    size: result.size,
  }
}

/**
 * 判断浏览器 File 对象是否代表一个本地目录（主要用于 Electron 拖拽场景）。
 *
 * Electron 拖拽文件夹时，File 对象通常带有 path 属性且无扩展名；
 * Web 浏览器无法直接获得目录信息，返回 false。
 */
export function isLocalDirectory(file: File): boolean {
  if (!isElectron()) return false
  const electronFile = file as File & { path?: string }
  const localPath = electronFile.path
  if (!localPath) return false
  // 无扩展名且不是已知数据文件扩展名，则视为目录
  return !/\.(xlsx|xls|csv|json)$/i.test(localPath)
}

/**
 * 读取本地目录内的文件条目（Electron）或返回空（Web 不支持）。
 */
export async function readLocalDirectoryEntries(
  dirPath: string,
  extensions?: string[]
): Promise<string[]> {
  if (!isElectron()) {
    logger.warn('[fileApi] Web 模式下不支持直接读取本地目录条目')
    return []
  }
  return readdirRecursive(dirPath, extensions)
}

/**
 * 递归扫描目录，返回所有符合条件的文件路径列表
 *
 * @param path - 要扫描的目录路径
 * @param extensions - 允许的文件扩展名数组，例如 ['.csv', '.xlsx']
 * @returns 文件绝对路径数组
 */
export async function readdirRecursive(path: string, extensions?: string[]): Promise<string[]> {
  if (isElectron()) {
    const electronDetector = await import('@/core/utils/electronDetector')
    return electronDetector.scanDirectory(path, extensions)
  }

  // Web 实现：当前后端 /files/scan 仅支持单层扫描，这里先做单层实现
  // TODO: 后端 /files/scan 支持 recursive 参数后，改为单次调用
  const entries = await scanDirectory(path, extensions)
  const files: string[] = []

  for (const entry of entries) {
    if (entry.is_dir) {
      try {
        const subFiles = await readdirRecursive(entry.path, extensions)
        files.push(...subFiles)
      } catch (error) {
        logger.warn(`[fileApi] 递归扫描子目录失败: ${entry.path}`, error)
      }
    } else {
      files.push(entry.path)
    }
  }

  return files
}
