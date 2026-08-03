import { isElectron } from './electronDetector'
import * as webFileApi from '@/api/fileApi'
import { getPathBasename, joinPath } from './pathNormalization'

export function getFileDownloadUrl(path: string): string {
  return webFileApi.getFileDownloadUrl(path)
}

/**
 * B-sec1: root 为白名单根目录，Web 模式下必须传入（后端强制校验 path 落于 root 下）。
 * Electron 模式走原生 IPC，root 仅作签名兼容（原生不受此约束）。
 */
export async function readFile(path: string, root: string): Promise<string | null> {
  if (isElectron()) {
    return (await import('./electronDetector')).readFile(path)
  }
  return webFileApi.readFile(path, root)
}

export async function writeFile(path: string, content: string, root: string): Promise<void> {
  if (isElectron()) {
    const api = (await import('./electronDetector')).getElectronAPI()
    await api.writeFile(path, content)
    return
  }
  await webFileApi.writeFile(path, content, root)
}

export async function checkFileExists(path: string, root: string): Promise<boolean> {
  if (isElectron()) {
    return (await import('./electronDetector')).checkFileExists(path)
  }
  return webFileApi.checkFileExists(path, root)
}

export async function scanDirectory(
  path: string,
  root: string,
  extensions?: string[]
): Promise<Array<{ name: string; path: string; is_dir: boolean }>> {
  if (isElectron()) {
    // Electron's scanDirectory returns string[] (relative paths under `path`)
    const paths = await (await import('./electronDetector')).scanDirectory(path, extensions)
    return paths.map((p) => {
      const fullPath = joinPath(path, p)
      const name = getPathBasename(p) || p
      // Electron scanDirectory only returns file paths that match extensions,
      // so we treat them as files. Directories are not included in the result.
      return { name, path: fullPath, is_dir: false }
    })
  }
  return webFileApi.scanDirectory(path, root, extensions)
}

export async function makeDirectory(path: string, root: string): Promise<void> {
  if (isElectron()) {
    throw new Error('makeDirectory is only available in Web mode')
  }
  await webFileApi.makeDirectory(path, root)
}

export async function uploadFile(
  file: File
): Promise<{ temp_path: string; original_name: string; size: number }> {
  if (isElectron()) {
    throw new Error('uploadFile is only available in Web mode (Electron uses native file paths)')
  }
  return webFileApi.uploadFile(file)
}
