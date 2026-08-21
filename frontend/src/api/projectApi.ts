/**
 * Project management API calls for Web mode.
 * Replaces Electron IPC project operations with HTTP API calls.
 */

import apiClient from '@/core/services/httpClient'

export interface CreateProjectResponse {
  success: boolean
  name: string
  path: string
}

export interface CurrentProjectResponse {
  has_current: boolean
  path?: string
  name?: string
}

export async function createProject(path: string, name: string): Promise<CreateProjectResponse> {
  const { data } = await apiClient.post<CreateProjectResponse>('/projects/create', { path, name })
  return data
}

export async function getCurrentProject(): Promise<CurrentProjectResponse> {
  const { data } = await apiClient.get<CurrentProjectResponse>('/projects/current')
  return data
}

export async function closeProject(): Promise<{ success: boolean }> {
  const { data } = await apiClient.post<{ success: boolean }>('/projects/close')
  return data
}

export async function getAppVersion(): Promise<string> {
  const { data } = await apiClient.get<{ version: string }>('/version')
  return data.version
}
