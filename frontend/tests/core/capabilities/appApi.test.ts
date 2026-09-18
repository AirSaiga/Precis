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
 * @file appApi.test.ts
 * @description 应用能力抽象层 restartBackend 单元测试
 *
 * 覆盖 F3 修复契约：Electron 软重启重新生成后端 API 一次性 token，
 * restartPythonServer 结果携带新 token，ElectronAppAdapter 须据此调用
 * setApiToken 刷新内存态（否则旧 token 请求被后端 CORS 全部拒绝）；
 * Web 适配器无 token 环境，返回缺省 token 的结果且不动 token 状态。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  setApiToken: vi.fn(),
  getApiToken: vi.fn(() => ''),
  hasApiToken: vi.fn(() => false),
  updateApiBaseUrl: vi.fn(),
  apiGet: vi.fn(),
}))

vi.mock('@/core/services/apiToken', () => ({
  setApiToken: mocks.setApiToken,
  getApiToken: mocks.getApiToken,
  hasApiToken: mocks.hasApiToken,
}))

vi.mock('@/core/services/httpClient', () => ({
  default: { defaults: { baseURL: '' }, get: mocks.apiGet },
  updateApiBaseUrl: mocks.updateApiBaseUrl,
}))

vi.mock('@/core/utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

/** 注入 electronAPI（缺省）或移除（Web 环境），再重新导入被测模块（其适配器在模块级按环境选型） */
async function importAppApi(electronApi: Record<string, unknown> | null) {
  vi.resetModules()
  if (electronApi) {
    ;(window as unknown as Record<string, unknown>).electronAPI = electronApi
  } else {
    delete (window as unknown as Record<string, unknown>).electronAPI
  }
  return import('@/core/capabilities/appApi')
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('appApi.restartBackend（F3：restart 返回 token → 刷新内存态）', () => {
  it('Electron 环境：结果携带新 token 时调用 setApiToken 刷新并原样返回', async () => {
    const restartPythonServer = vi.fn().mockResolvedValue({
      ready: true,
      port: 9001,
      token: 'fresh-token-after-restart',
    })
    const { appApi } = await importAppApi({ restartPythonServer })

    const result = await appApi.restartBackend()

    expect(restartPythonServer).toHaveBeenCalledTimes(1)
    expect(mocks.setApiToken).toHaveBeenCalledWith('fresh-token-after-restart')
    expect(result).toEqual({ ready: true, token: 'fresh-token-after-restart' })
  })

  it('Electron 环境：结果无 token（旧主进程/开发模式）时不触碰 token 状态', async () => {
    const restartPythonServer = vi.fn().mockResolvedValue({ ready: false, error: 'spawn failed' })
    const { appApi } = await importAppApi({ restartPythonServer })

    const result = await appApi.restartBackend()

    expect(mocks.setApiToken).not.toHaveBeenCalled()
    expect(result).toEqual({ ready: false, token: undefined })
  })

  it('Web 环境：不支持重启，返回 ready=false 且不触碰 token 状态', async () => {
    const { appApi } = await importAppApi(null)

    const result = await appApi.restartBackend()

    expect(mocks.setApiToken).not.toHaveBeenCalled()
    expect(result).toEqual({ ready: false })
  })
})
