/**
 * Unified file operation layer.
 *
 * Electron mode: uses window.electronAPI (IPC to main process)
 * Web mode: uses HTTP API calls to the backend
 *
 * This provides a consistent interface regardless of environment.
 */

import { isElectron } from './electronDetector'
import * as webFileApi from '@/api/fileApi'

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
  extensions?: string[],
): Promise<Array<{ name: string; path: string; is_dir: boolean }>> {
  if (isElectron()) {
    // Electron's scanDirectory returns string[] (relative paths)
    // Convert to the unified format
    const paths = await (await import('./electronDetector')).scanDirectory(path, extensions)
    return paths.map((p) => ({ name: p, path: p, is_dir: false }))
  }
  return webFileApi.scanDirectory(path, extensions)
}

export async function uploadFile(file: File): Promise<{ temp_path: string; original_name: string }> {
  if (isElectron()) {
    throw new Error('uploadFile is only available in Web mode (Electron uses native file paths)')
  }
  return webFileApi.uploadFile(file)
}
