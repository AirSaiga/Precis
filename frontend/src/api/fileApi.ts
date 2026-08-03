/**
 * File operation API calls for Web mode.
 * Replaces Electron IPC file operations with HTTP API calls.
 *
 * B-sec1 安全约束：read/write/exists/scan/mkdir 均需传入 root（白名单根目录），
 * 后端 assert_path_within_root 会强制要求 path 落于 root 下，拒绝项目外任意文件读写。
 * root 应为当前项目配置目录（projectStore.configPath）。
 */

import apiClient from '@/core/services/httpClient'

export interface DirectoryEntry {
  name: string
  path: string
  is_dir: boolean
}

export async function readFile(path: string, root: string): Promise<string> {
  const { data } = await apiClient.post<{ content: string }>('/files/read', { path, root })
  return data.content
}

export async function writeFile(path: string, content: string, root: string): Promise<void> {
  await apiClient.post('/files/write', { path, content, root })
}

export async function checkFileExists(path: string, root: string): Promise<boolean> {
  const { data } = await apiClient.get<{ exists: boolean }>('/files/exists', {
    params: { path, root },
  })
  return data.exists
}

export async function scanDirectory(
  path: string,
  root: string,
  extensions?: string[]
): Promise<DirectoryEntry[]> {
  const { data } = await apiClient.post<{ entries: DirectoryEntry[] }>('/files/scan', {
    path,
    root,
    extensions,
  })
  return data.entries
}

export async function makeDirectory(path: string, root: string): Promise<void> {
  await apiClient.post('/files/mkdir', { path, root })
}

export async function uploadFile(
  file: File
): Promise<{ temp_path: string; original_name: string; size: number }> {
  const formData = new FormData()
  formData.append('file', file)
  const { data } = await apiClient.post<{ temp_path: string; original_name: string; size: number }>(
    '/files/upload',
    formData,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
    }
  )
  return data
}

export function getFileDownloadUrl(path: string): string {
  return `${apiClient.defaults.baseURL as string}/files/download?path=${encodeURIComponent(path)}`
}
