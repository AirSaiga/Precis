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
 * @fileoverview V2 模板类型：模板定义引用、模板文件内容与模板实例引用。
 */

/**
 * 模板资源引用。
 *
 * 用于在 project.precis.yaml 中索引模板定义文件。
 */
export interface TemplateRefV2 {
  /** 模板唯一标识符 */
  id: string
  /** 模板文件路径（相对于项目目录） */
  path: string
}

/**
 * 模板定义文件内容（full config 响应的 templates 字典值）。
 *
 * 仅声明前端消费的字段，其余结构（nodes 等）按 unknown 透传。
 */
export interface TemplateFileContentV2 {
  id: string
  name: string
  description?: string
  nodes?: unknown[]
  [key: string]: unknown
}

/**
 * 模板实例引用。
 *
 * 用于在 project.precis.yaml 中记录模板实例的配置。
 */
export interface TemplateInstanceRefV2 {
  /** 模板实例唯一标识符 */
  id: string
  /** 引用的模板定义 ID */
  template_id: string
  /** 是否启用 */
  enabled: boolean
}
