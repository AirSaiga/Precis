/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copyright 2026 Precis Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
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

export interface CheckProjectResponse {
  path: string
  dir_exists: boolean
  is_project: boolean
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

/**
 * 只读探测目录是否为 Precis 项目根（GET /projects/check）。
 *
 * 端点设计为**永不 404**——空目录/不存在的目录都用布尔字段表达，供智能打开
 * （useSmartProjectOpen）预判，避免探测请求在浏览器控制台留下 404 红字。
 */
export async function checkProject(path: string): Promise<CheckProjectResponse> {
  const { data } = await apiClient.get<CheckProjectResponse>('/projects/check', {
    params: { path },
  })
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
