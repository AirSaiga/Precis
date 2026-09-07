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
 * @file manifest.ts
 * @description V2 manifest 读写与引用更新 API
 */

import apiClient from '@/core/services/httpClient'
import { logger } from '@/core/utils/logger'
import { getApiErrorMessage, type ApiErrorLike } from '@/core/services/apiErrors'
import type { ProjectManifestV2 } from '@/types/projectV2'
import { withConfigPathHeader } from './shared'

function isApiErrorLike(e: unknown): e is ApiErrorLike {
  return typeof e === 'object' && e !== null && 'response' in e
}

/**
 * 清单写操作的统一异常出口：用户消息只保留后端 detail 的可读文本，
 * 技术上下文（项目路径、状态码、原始异常）记入日志。
 *
 * 注意 getV2Manifest 刻意不走本函数：其 AxiosError 形状被编排器
 * isProjectNotFound（404=首次保存）依赖，包裹会破坏该分支。
 */
function throwManifestError(e: unknown): never {
  let status: number | undefined
  let configPath: unknown
  if (isApiErrorLike(e)) {
    status = e.response?.status
    const headers = (e as { config?: { headers?: Record<string, unknown> } }).config?.headers
    configPath =
      headers?.['X-Project-Config-Path'] ??
      headers?.['x-project-config-path'] ??
      headers?.['X-PROJECT-CONFIG-PATH']
  }
  logger.warn('[manifest API] 清单请求失败:', { status, configPath, error: e })
  throw new Error(getApiErrorMessage(e, '清单操作失败，请稍后重试'))
}

/**
 * 获取 V2 项目清单（manifest）
 */
export async function getV2Manifest(configPath?: string): Promise<ProjectManifestV2> {
  const { data } = await apiClient.get<ProjectManifestV2>(
    '/project/manifest',
    withConfigPathHeader(configPath)
  )
  return data
}

/**
 * 保存 V2 项目清单
 *
 * @param replace - 是否完全替换（可选，默认合并）
 */
export async function putV2Manifest(
  manifest: ProjectManifestV2,
  configPath?: string,
  replace?: boolean
): Promise<void> {
  try {
    await apiClient.put('/project/manifest', manifest, {
      ...(configPath ? { headers: { 'X-Project-Config-Path': configPath } } : {}),
      ...(replace ? { params: { replace: true } } : {}),
    })
  } catch (e: unknown) {
    throwManifestError(e)
  }
}

export async function updateV2ManifestSchemaRef(
  schemaRef: { id: string; path: string },
  configPath?: string
): Promise<void> {
  try {
    await apiClient.put('/project/manifest/schema', schemaRef, withConfigPathHeader(configPath))
  } catch (e: unknown) {
    throwManifestError(e)
  }
}

export async function updateV2ManifestConstraintRef(
  constraintRef: { id: string; path: string },
  configPath?: string
): Promise<void> {
  try {
    await apiClient.put(
      '/project/manifest/constraint',
      constraintRef,
      withConfigPathHeader(configPath)
    )
  } catch (e: unknown) {
    throwManifestError(e)
  }
}

export async function updateV2ManifestRegexRef(
  regexRef: { id: string; path: string },
  configPath?: string
): Promise<void> {
  try {
    await apiClient.put('/project/manifest/regex', regexRef, withConfigPathHeader(configPath))
  } catch (e: unknown) {
    throwManifestError(e)
  }
}

export async function updateV2ManifestTransformRef(
  transformRef: { id: string; path: string },
  configPath?: string
): Promise<void> {
  try {
    await apiClient.put(
      '/project/manifest/transform',
      transformRef,
      withConfigPathHeader(configPath)
    )
  } catch (e: unknown) {
    throwManifestError(e)
  }
}
