/**
 * @file manifest.ts
 * @description V2 manifest 读写与引用更新 API
 */

import apiClient from '@/core/services/httpClient'
import type { ProjectManifestV2 } from '@/types/projectV2'
import { withConfigPathHeader } from './shared'

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
  } catch (e: any) {
    const detail = e?.response?.data?.detail
    const errorText =
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map((d: any) => d?.msg || d?.message || JSON.stringify(d)).join('; ')
          : e?.response?.data?.error || e?.message || '请求失败'
    const headers = e?.config?.headers
    const configPath =
      headers?.['X-Project-Config-Path'] ||
      headers?.['x-project-config-path'] ||
      headers?.['X-PROJECT-CONFIG-PATH']
    throw new Error(configPath ? `X-Project-Config-Path=${configPath} | ${errorText}` : errorText)
  }
}

export async function updateV2ManifestSchemaRef(
  schemaRef: { id: string; path: string },
  configPath?: string
): Promise<void> {
  try {
    await apiClient.put(
      '/project/manifest/schema',
      schemaRef,
      withConfigPathHeader(configPath)
    )
  } catch (e: any) {
    const detail = e?.response?.data?.detail
    const errorText =
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map((d: any) => d?.msg || d?.message || JSON.stringify(d)).join('; ')
          : e?.response?.data?.error || e?.message || '请求失败'
    const headers = e?.config?.headers
    const configPath =
      headers?.['X-Project-Config-Path'] ||
      headers?.['x-project-config-path'] ||
      headers?.['X-PROJECT-CONFIG-PATH']
    throw new Error(configPath ? `X-Project-Config-Path=${configPath} | ${errorText}` : errorText)
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
  } catch (e: any) {
    const detail = e?.response?.data?.detail
    const errorText =
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map((d: any) => d?.msg || d?.message || JSON.stringify(d)).join('; ')
          : e?.response?.data?.error || e?.message || '请求失败'
    const headers = e?.config?.headers
    const configPath =
      headers?.['X-Project-Config-Path'] ||
      headers?.['x-project-config-path'] ||
      headers?.['X-PROJECT-CONFIG-PATH']
    throw new Error(configPath ? `X-Project-Config-Path=${configPath} | ${errorText}` : errorText)
  }
}

export async function updateV2ManifestRegexRef(
  regexRef: { id: string; path: string },
  configPath?: string
): Promise<void> {
  try {
    await apiClient.put(
      '/project/manifest/regex',
      regexRef,
      withConfigPathHeader(configPath)
    )
  } catch (e: any) {
    const detail = e?.response?.data?.detail
    const errorText =
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map((d: any) => d?.msg || d?.message || JSON.stringify(d)).join('; ')
          : e?.response?.data?.error || e?.message || '请求失败'
    const headers = e?.config?.headers
    const configPath =
      headers?.['X-Project-Config-Path'] ||
      headers?.['x-project-config-path'] ||
      headers?.['X-PROJECT-CONFIG-PATH']
    throw new Error(configPath ? `X-Project-Config-Path=${configPath} | ${errorText}` : errorText)
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
  } catch (e: any) {
    const detail = e?.response?.data?.detail
    const errorText =
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map((d: any) => d?.msg || d?.message || JSON.stringify(d)).join('; ')
          : e?.response?.data?.error || e?.message || '请求失败'
    const headers = e?.config?.headers
    const configPath =
      headers?.['X-Project-Config-Path'] ||
      headers?.['x-project-config-path'] ||
      headers?.['X-PROJECT-CONFIG-PATH']
    throw new Error(configPath ? `X-Project-Config-Path=${configPath} | ${errorText}` : errorText)
  }
}
