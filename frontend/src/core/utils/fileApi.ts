import { isElectron } from './electronDetector'
import * as webFileApi from '@/api/fileApi'
import { getPathBasename, joinPath } from './pathNormalization'

export function getFileDownloadUrl(path: string): string {
  return webFileApi.getFileDownloadUrl(path)
}

export async function readFile(path: string): Promise<string | null> {
  if (isElectron()) {
    return (await import('./electronDetector')).readFile(path)
  }
  return webFileApi.readFile(path)
}

export async function writeFile(path: string, content: string): Promise<void> {
  if (isElectron()) {
    const api = (await import('./electronDetector')).getElectronAPI()
    await api.writeFile(path, content)
    return
  }
  await webFileApi.writeFile(path, content)
}

export async function checkFileExists(path: string): Promise<boolean> {
  if (isElectron()) {
    return (await import('./electronDetector')).checkFileExists(path)
  }
  return webFileApi.checkFileExists(path)
}

export async function scanDirectory(
  path: string,
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
  return webFileApi.scanDirectory(path, extensions)
}

export async function makeDirectory(path: string): Promise<void> {
  if (isElectron()) {
    throw new Error('makeDirectory is only available in Web mode')
  }
  await webFileApi.makeDirectory(path)
}

export async function uploadFile(
  file: File
): Promise<{ temp_path: string; original_name: string; size: number }> {
  if (isElectron()) {
    throw new Error('uploadFile is only available in Web mode (Electron uses native file paths)')
  }
  return webFileApi.uploadFile(file)
}
