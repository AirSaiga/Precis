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
 * @fileoverview V2 全量配置 API 类型：GET/PUT /project/config/full 的响应与请求体
 * （清单 + 全部资源文件字典）。
 */

import type { ProjectManifestV2 } from './manifest'
import type { TableSchemaFileV2 } from './schema'
import type { ConstraintFileV2 } from './constraints'
import type { RegexNodeFileV2 } from './regex'
import type { TransformFileV2 } from './transform'
import type { ManualDataFileV2 } from './manualData'
import type { TemplateFileContentV2 } from './templates'
import type { InspectionResultV2 } from './inspection'

/**
 * V2 完整配置响应。
 *
 * 后端 getV2FullConfig() API 返回的完整项目配置，包含清单和所有资源文件内容。
 */
export interface FullConfigV2Response {
  /** 项目清单 */
  manifest: ProjectManifestV2
  /** 生效的清单（合并后的实际配置） */
  effective_manifest?: ProjectManifestV2
  /** Schema 文件映射：schema_id -> TableSchemaFileV2 */
  schemas: Record<string, TableSchemaFileV2>
  /** 约束文件映射：constraint_id -> ConstraintFileV2 */
  constraints: Record<string, ConstraintFileV2>
  /** 正则注册表映射 */
  regex_registries: Record<string, unknown>
  /** Regex 节点文件映射：regex_id -> RegexNodeFileV2 */
  regex_nodes: Record<string, RegexNodeFileV2>
  /** Transform 文件映射：transform_id -> TransformFileV2 */
  transforms: Record<string, TransformFileV2>
  /**
   * ManualData 文件映射：manual_data_id -> ManualDataFileV2。
   * 后端 /project/config/full 实际返回该字典（画布水合回显依赖它），
   * 此前前端类型漏声明导致 hydrate 只能读到 manifest ref（无数据）。
   */
  manual_data?: Record<string, ManualDataFileV2>
  /**
   * Template 定义文件映射：template_id -> 模板内容（含 name 等元信息）。
   *
   * 资源树与检查器据此解析模板显示名（此前只能拿到 id，节点标题显示 id 断链）。
   */
  templates?: Record<string, TemplateFileContentV2>
  /**
   * 配置覆盖信息。
   *
   * 描述 manifest 中列出的资源与实际文件之间的差异：
   * - unlisted: 文件存在但 manifest 中未列出
   * - dangling: manifest 列出但文件不存在
   */
  coverage?: {
    /** 配置是否完整（无遗漏、无悬空） */
    is_complete: boolean
    /** 未列入清单的资源 */
    unlisted: {
      schemas: Array<{ id: string; path: string }>
      constraints: Array<{ id: string; path: string }>
      regex_nodes: Array<{ id: string; path: string }>
      transforms: Array<{ id: string; path: string }>
    }
    /** 悬空引用（manifest 列出但文件缺失） */
    dangling: {
      schemas: Array<{ id: string; path: string }>
      constraints: Array<{ id: string; path: string }>
      regex_nodes: Array<{ id: string; path: string }>
      transforms: Array<{ id: string; path: string }>
    }
  } | null
  /** 清单是否被修改过（与原始文件对比） */
  manifest_modified?: boolean
  /** Schema 文件解析错误映射: schema_id -> 错误信息 */
  schema_errors?: Record<string, string>
  /** 配置自检结果（仅 inspect=true 时返回） */
  inspection?: InspectionResultV2
}

/**
 * V2 完整配置请求。
 *
 * 前端 saveProject() 时向后端发送的完整项目配置。
 */
export interface FullConfigV2Request {
  /** 项目清单 */
  manifest: ProjectManifestV2
  /** Schema 文件映射 */
  schemas: Record<string, TableSchemaFileV2>
  /** 约束文件映射 */
  constraints: Record<string, ConstraintFileV2>
  /** Regex 节点文件映射 */
  regex_nodes: Record<string, RegexNodeFileV2>
  /** Transform 文件映射 */
  transforms: Record<string, TransformFileV2>
  /** ManualData 文件映射 */
  manual_data: Record<string, ManualDataFileV2>
}
