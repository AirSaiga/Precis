/**
 * @file manifest.ts
 * @description V2 manifest 读写与引用更新 API
 */

import apiClient from '@/core/services/httpClient'
import type { ProjectManifestV2 } from '@/types/projectV2'
import { withConfigPathHeader } from './shared'

interface AxiosLikeError {
  response?: { data?: unknown; status?: number }
  config?: { headers?: Record<string, unknown> }
  message?: string
}

function isAxiosLikeError(e: unknown): e is AxiosLikeError {
  return typeof e === 'object' && e !== null && ('response' in e || 'config' in e)
}

/**
 * 从 Axios 风格错误中构建可读的异常信息，同时从请求头中提取 config path 便于排查。
 */
function buildManifestErrorMessage(e: unknown): string {
  if (!isAxiosLikeError(e)) {
    return e instanceof Error ? e.message : '请求失败'
  }

  const data = e.response?.data as { detail?: unknown; error?: unknown } | undefined
  const detail = data?.detail
  const errorText =
    typeof detail === 'string'
      ? detail
      : Array.isArray(detail)
        ? detail
            .map((d) =>
              String(
                (d as Record<string, unknown>).msg ??
                  (d as Record<string, unknown>).message ??
                  JSON.stringify(d)
              )
            )
            .join('; ')
        : String(data?.error ?? e.message ?? '请求失败')

  const headers = e.config?.headers
  const configPathFromHeader =
    headers?.['X-Project-Config-Path'] ||
    headers?.['x-project-config-path'] ||
    headers?.['X-PROJECT-CONFIG-PATH']

  return configPathFromHeader
    ? `X-Project-Config-Path=${configPathFromHeader} | ${errorText}`
    : errorText
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
    throw new Error(buildManifestErrorMessage(e))
  }
}

export async function updateV2ManifestSchemaRef(
  schemaRef: { id: string; path: string },
  configPath?: string
): Promise<void> {
  try {
    await apiClient.put('/project/manifest/schema', schemaRef, withConfigPathHeader(configPath))
  } catch (e: unknown) {
    throw new Error(buildManifestErrorMessage(e))
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
    throw new Error(buildManifestErrorMessage(e))
  }
}

export async function updateV2ManifestRegexRef(
  regexRef: { id: string; path: string },
  configPath?: string
): Promise<void> {
  try {
    await apiClient.put('/project/manifest/regex', regexRef, withConfigPathHeader(configPath))
  } catch (e: unknown) {
    throw new Error(buildManifestErrorMessage(e))
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
    throw new Error(buildManifestErrorMessage(e))
  }
}
