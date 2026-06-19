/**
 * File operation API calls for Web mode.
 * Replaces Electron IPC file operations with HTTP API calls.
 */

import apiClient from '@/core/services/httpClient'

export interface DirectoryEntry {
  name: string
  path: string
  is_dir: boolean
}

export async function readFile(path: string): Promise<string> {
  const { data } = await apiClient.post<{ content: string }>('/files/read', { path })
  return data.content
}

export async function writeFile(path: string, content: string): Promise<void> {
  await apiClient.post('/files/write', { path, content })
}

export async function checkFileExists(path: string): Promise<boolean> {
  const { data } = await apiClient.get<{ exists: boolean }>('/files/exists', { params: { path } })
  return data.exists
}

export async function scanDirectory(path: string, extensions?: string[]): Promise<DirectoryEntry[]> {
  const { data } = await apiClient.post<{ entries: DirectoryEntry[] }>('/files/scan', { path, extensions })
  return data.entries
}

export async function makeDirectory(path: string): Promise<void> {
  await apiClient.post('/files/mkdir', { path })
}

export async function uploadFile(file: File): Promise<{ temp_path: string; original_name: string; size: number }> {
  const formData = new FormData()
  formData.append('file', file)
  const { data } = await apiClient.post<{ temp_path: string; original_name: string; size: number }>(
    '/files/upload',
    formData,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
    },
  )
  return data
}

export function getFileDownloadUrl(path: string): string {
  return `${apiClient.defaults.baseURL as string}/files/download?path=${encodeURIComponent(path)}`
}
