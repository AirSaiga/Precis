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
 * @fileoverview 配置自检修复 API：把磁盘已存在但未入清单的孤儿资源"收养"登记进 manifest
 */

import apiClient from '@/core/services/httpClient'
import { isProjectNotFound, ProjectNotFoundError } from './shared'

/** 可收养（登记进 manifest）的资源种类 */
export type AdoptableResourceKind = 'schema' | 'constraint' | 'regex' | 'transform' | 'manual_data'

export interface AdoptUnlistedRequest {
  /** 资源种类 */
  resourceType: AdoptableResourceKind
  /** 资源 id（与 resourcePath 二选一） */
  resourceId?: string
  /** 资源相对项目根的路径（与 resourceId 二选一） */
  resourcePath?: string
}

export interface AdoptUnlistedResponse {
  message: string
  /** true 表示资源本就已登记（幂等语义，未重复追加） */
  alreadyListed: boolean
  /** 登记使用的资源 id（取文件实际 id） */
  resourceId: string
}

/**
 * 把磁盘已存在但未登记进 project.precis.yaml 的资源"收养"登记进清单
 *
 * 幂等：已登记时返回 alreadyListed=true。文件不存在抛 404（ProjectNotFoundError
 * 仅覆盖项目级 404，资源级 404 以原始 Axios 错误抛出，由调用方提示）。
 */
export async function adoptUnlistedResource(
  payload: AdoptUnlistedRequest,
  configPath?: string
): Promise<AdoptUnlistedResponse> {
  try {
    const { data } = await apiClient.post<AdoptUnlistedResponse>(
      '/project/inspection/adopt-unlisted',
      {
        resource_type: payload.resourceType,
        resource_id: payload.resourceId,
        resource_path: payload.resourcePath,
      },
      configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
    )
    return data
  } catch (e) {
    if (isProjectNotFound(e)) {
      throw new ProjectNotFoundError(configPath)
    }
    throw e
  }
}
