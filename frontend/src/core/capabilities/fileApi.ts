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
 * Electron 下解析浏览器 File 对象对应的本地绝对路径（Web 模式返回空串）。
 *
 * Electron 32+ 已移除 File.path 属性（读取恒为 undefined），官方替代是
 * webUtils.getPathForFile(file)。File 对象无法过 IPC 结构化克隆，因此由
 * preload 直接调用 webUtils 并返回结果字符串，此处经能力封装调用。
 */
export async function getLocalPathForFile(file: File): Promise<string> {
  if (!isElectron()) return ''
  try {
    const localPath = window.electronAPI.getPathForFile(file)
    return typeof localPath === 'string' ? localPath : ''
  } catch (error) {
    logger.warn('[fileApi] 解析拖拽文件本地路径失败:', file.name, error)
    return ''
  }
}

/**
 * 将浏览器 File 对象解析为后端可访问的路径。
 *
 * Electron 模式下，经 preload 的 webUtils.getPathForFile 解析本地绝对路径
 * （Electron 32+ 已移除 File.path）；路径解析失败时抛错而非退化为裸文件名
 * ——裸文件名后端无法打开，静默降级只会产生不可用的数据源。
 * Web 模式下，将文件上传到后端临时目录并返回临时路径。
 */
export async function resolveFileReference(file: File): Promise<ResolvedFileReference> {
  if (isElectron()) {
    const localPath = await getLocalPathForFile(file)
    if (localPath) {
      return {
        path: localPath,
        name: file.name,
        size: file.size,
      }
    }
    logger.error('[fileApi] Electron 下未能解析拖拽文件本地路径:', file.name)
    throw new Error(`无法解析拖拽文件的本地路径: ${file.name}`)
  }

  const result = await uploadFile(file)
  return {
    path: result.temp_path,
    name: result.original_name,
    size: result.size,
  }
}

/**
 * 已知数据文件扩展名（小写不敏感）：拖拽条目命中则视为"文件"，
 * 其余（无扩展名等）在 Electron 拖拽场景按目录处理（递归扫描）。
 */
const DATA_FILE_PATH_PATTERN = /\.(xlsx|xls|csv|json|yaml|yml|jsonl|tsv|txt)$/i

/**
 * 判断浏览器 File 对象是否代表一个本地目录（主要用于 Electron 拖拽场景）。
 *
 * Electron 32+ 已移除 File.path，先经 webUtils.getPathForFile 解析真实路径，
 * 再按扩展名判断：命中数据文件扩展名（含 .yaml/.yml/.jsonl/.tsv/.txt）视为
 * 文件，避免已知数据文件被误当文件夹递归扫描；其余视为目录。
 * Web 浏览器无法直接获得目录信息，返回 false。
 */
export async function isLocalDirectory(file: File): Promise<boolean> {
  if (!isElectron()) return false
  const localPath = await getLocalPathForFile(file)
  if (!localPath) return false
  // 命中已知数据文件扩展名 → 文件；否则视为目录
  return !DATA_FILE_PATH_PATTERN.test(localPath)
}

/**
 * 读取本地目录内的文件条目（Electron）或返回空（Web 不支持）。
 *
 * @param dirPath - 要扫描的目录路径
 * @param root - 白名单根目录（Web 模式下后端强制 path 落于此目录下；Electron 忽略）
 * @param extensions - 允许的文件扩展名数组，例如 ['.csv', '.xlsx']
 */
export async function readLocalDirectoryEntries(
  dirPath: string,
  root: string,
  extensions?: string[]
): Promise<string[]> {
  if (!isElectron()) {
    logger.warn('[fileApi] Web 模式下不支持直接读取本地目录条目')
    return []
  }
  return readdirRecursive(dirPath, root, extensions)
}

/**
 * 递归扫描目录，返回所有符合条件的文件路径列表
 *
 * @param path - 要扫描的目录路径
 * @param root - 白名单根目录（Web 模式下后端强制 path 落于此目录下；Electron 忽略）
 * @param extensions - 允许的文件扩展名数组，例如 ['.csv', '.xlsx']
 * @returns 文件绝对路径数组
 */
export async function readdirRecursive(
  path: string,
  root: string,
  extensions?: string[]
): Promise<string[]> {
  if (isElectron()) {
    const electronDetector = await import('@/core/utils/electronDetector')
    return electronDetector.scanDirectory(path, extensions)
  }

  // Web 实现：当前后端 /files/scan 仅支持单层扫描，这里先做单层实现
  // TODO: 后端 /files/scan 支持 recursive 参数后，改为单次调用
  const entries = await scanDirectory(path, root, extensions)
  const files: string[] = []

  for (const entry of entries) {
    if (entry.is_dir) {
      try {
        const subFiles = await readdirRecursive(entry.path, root, extensions)
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
