/**
 * Project management API calls for Web mode.
 * Replaces Electron IPC project operations with HTTP API calls.
 */

import apiClient from '@/core/services/httpClient'

export interface ProjectInfo {
  name: string
  path: string
  schema_count: number
  constraint_count: number
  last_modified: string
}

export interface ScanResponse {
  work_dir: string
  projects: ProjectInfo[]
}

export interface OpenProjectResponse {
  success: boolean
  name: string
  path: string
}

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

export async function scanProjects(workDir?: string): Promise<ScanResponse> {
  const params: Record<string, string> = {}
  if (workDir) params.work_dir = workDir
  const { data } = await apiClient.get<ScanResponse>('/projects/scan', { params })
  return data
}

export async function openProject(path: string): Promise<OpenProjectResponse> {
  const { data } = await apiClient.post<OpenProjectResponse>('/projects/open', { path })
  return data
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
