/**
 * @file projectV2Api.test.ts
 * @description V2 项目配置 API 客户端集成测试
 *
 * 通过 axios adapter stub 拦截真实网络请求，验证 API 客户端契约：
 * - URL 路径正确
 * - HTTP 方法正确
 * - 请求体正确
 * - configPath 参数正确转换为 X-Project-Config-Path header
 * - 错误处理：错误响应被格式化为友好的 Error
 *
 * 实现方式：直接替换 apiClient.defaults.adapter，避免模块 mock。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import apiClient from '@/core/services/httpClient'
import {
  getV2Manifest,
  putV2Manifest,
  updateV2ManifestSchemaRef,
  updateV2ManifestConstraintRef,
  updateV2ManifestRegexRef,
} from '@/api/projectV2Api'

interface CapturedRequest {
  method: string
  url: string
  data: unknown
  headers: Record<string, string>
  params: Record<string, unknown>
}

describe('projectV2Api - manifest 端点', () => {
  let captured: CapturedRequest | undefined
  let mockResponse: { status: number; data: unknown }

  beforeEach(() => {
    captured = undefined
    mockResponse = { status: 200, data: { ok: true } }
    // 替换 apiClient 的 adapter，捕获请求而不真正发出去
    apiClient.defaults.adapter = (config) => {
      captured = {
        method: (config.method || 'get').toUpperCase(),
        url: config.url || '',
        data: config.data,
        headers: (config.headers || {}) as Record<string, string>,
        params: (config.params || {}) as Record<string, unknown>,
      }
      if (mockResponse.status >= 400) {
        const err = new Error('Request failed') as Error & {
          response?: { data: unknown; status: number; headers: Record<string, string>; config: typeof config }
          config?: typeof config
        }
        err.config = config
        err.response = {
          data: mockResponse.data,
          status: mockResponse.status,
          headers: {},
          config,
        }
        return Promise.reject(err)
      }
      return Promise.resolve({
        data: mockResponse.data,
        status: mockResponse.status,
        statusText: 'OK',
        headers: {},
        config,
      })
    }
  })

  afterEach(() => {
    // 还原 adapter（避免污染其他测试）
    apiClient.defaults.adapter = undefined
  })

  describe('getV2Manifest', () => {
    it('不带 configPath 时调用 GET /project/manifest', async () => {
      mockResponse = { status: 200, data: { version: 2, project: { id: 'p' } } }

      const result = await getV2Manifest()

      expect(captured).toBeDefined()
      expect(captured!.method).toBe('GET')
      expect(captured!.url).toBe('/project/manifest')
      expect(result).toEqual({ version: 2, project: { id: 'p' } })
    })

    it('传入 configPath 时正确设置 X-Project-Config-Path header', async () => {
      mockResponse = { status: 200, data: { version: 2 } }

      await getV2Manifest('/abs/path/to/project')

      expect(captured!.headers['X-Project-Config-Path']).toBe('/abs/path/to/project')
    })
  })

  describe('putV2Manifest', () => {
    it('默认调用 PUT /project/manifest（无 replace 参数）', async () => {
      const manifest = { version: 2, project: { id: 'p', name: 'P' }, schemas: [] }

      await putV2Manifest(manifest)

      expect(captured!.method).toBe('PUT')
      expect(captured!.url).toBe('/project/manifest')
      // axios 会将 body 序列化为 JSON 字符串
      expect(JSON.parse(captured!.data as string)).toEqual(manifest)
      // 默认 replace=false 时，URL 中不包含 replace=true
      expect(captured!.params.replace).toBeUndefined()
    })

    it('replace=true 时添加 replace=true 查询参数', async () => {
      const manifest = { version: 2, project: { id: 'p', name: 'P' }, schemas: [] }

      await putV2Manifest(manifest, undefined, true)

      // API 内部使用布尔 true 传递（FastAPI 自动转换）
      expect(captured!.params.replace).toBe(true)
    })

    it('错误时抛出包含 X-Project-Config-Path 的友好 Error', async () => {
      mockResponse = { status: 404, data: { detail: 'Manifest 文件不存在' } }
      const manifest = { version: 2, project: { id: 'p', name: 'P' }, schemas: [] }

      await expect(putV2Manifest(manifest, '/abs/proj')).rejects.toThrow(
        /X-Project-Config-Path=.*Manifest/
      )
    })

    it('错误响应无 detail 时回退到 error 字段', async () => {
      mockResponse = { status: 500, data: { error: 'Internal Server Error' } }

      await expect(putV2Manifest({ version: 2 })).rejects.toThrow(/Internal Server Error/)
    })
  })

  describe('upsert 引用端点', () => {
    it('updateV2ManifestSchemaRef 调用 PUT /project/manifest/schema', async () => {
      await updateV2ManifestSchemaRef({ id: 'users', path: 'schemas/users.schema.yaml' })

      expect(captured!.method).toBe('PUT')
      expect(captured!.url).toBe('/project/manifest/schema')
      // axios 会将 body 序列化为 JSON 字符串
      expect(JSON.parse(captured!.data as string)).toEqual({
        id: 'users',
        path: 'schemas/users.schema.yaml',
      })
    })

    it('updateV2ManifestConstraintRef 调用 PUT /project/manifest/constraint', async () => {
      await updateV2ManifestConstraintRef({ id: 'nn_email', path: 'constraints/nn_email.yaml' })

      expect(captured!.method).toBe('PUT')
      expect(captured!.url).toBe('/project/manifest/constraint')
      expect(JSON.parse(captured!.data as string)).toEqual({
        id: 'nn_email',
        path: 'constraints/nn_email.yaml',
      })
    })

    it('updateV2ManifestRegexRef 调用 PUT /project/manifest/regex', async () => {
      await updateV2ManifestRegexRef({ id: 'email_format', path: 'regex/email.regex.yaml' })

      expect(captured!.method).toBe('PUT')
      expect(captured!.url).toBe('/project/manifest/regex')
      expect(JSON.parse(captured!.data as string)).toEqual({
        id: 'email_format',
        path: 'regex/email.regex.yaml',
      })
    })

    it('upsert 错误时抛出格式化的 Error', async () => {
      mockResponse = { status: 422, data: { detail: [{ msg: 'invalid id' }] } }

      await expect(
        updateV2ManifestSchemaRef({ id: 'invalid', path: 'p' }, '/abs/proj')
      ).rejects.toThrow(/invalid id/)
    })
  })
})
