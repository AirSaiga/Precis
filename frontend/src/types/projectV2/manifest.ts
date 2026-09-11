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
 * @fileoverview V2 项目清单类型：项目基本信息、三大设置组（校验/文件处理/脚本安全）
 * 与 project.precis.yaml 清单结构（索引全部资源引用）。
 */

import type { DataSourceRefV2 } from './dataSources'
import type { SchemaRefV2 } from './schema'
import type { ConstraintRefV2 } from './constraints'
import type { RegexNodeRefV2 } from './regex'
import type { TransformRefV2 } from './transform'
import type { ManualDataRefV2 } from './manualData'
import type { TemplateRefV2, TemplateInstanceRefV2 } from './templates'

/**
 * 项目基本信息。
 */
export interface ProjectInfoV2 {
  /** 项目唯一标识符 */
  id: string
  /** 项目名称 */
  name: string
  /** 项目描述（可选；手写元数据，全量保存时经前端并集与后端合并防线双重保全） */
  description?: string
}

/**
 * 校验设置。
 *
 * 控制数据校验的全局行为。
 */
export interface ValidationSettings {
  /** 是否自动执行校验 */
  auto_validate: boolean
  /** 是否启用严格模式（严格模式下任何错误都视为失败） */
  strict_mode: boolean
  /**
   * 错误处理方式
   * @values
   * - 'stop': 遇到第一个错误即停止
   * - 'continue': 继续处理后续数据
   * - 'report': 仅报告错误不中断流程
   */
  error_handling: 'stop' | 'continue' | 'report'
  /** 校验超时时间（秒） */
  timeout_seconds: number
  /** 批量处理的最大文件数 */
  batch_max_files: number
}

/**
 * 校验运行时设置（ValidationSettings 的别名）。
 */
export type ValidationRunSettings = ValidationSettings

/**
 * 文件处理设置。
 *
 * 控制数据文件的读取和解析行为。
 * 字段须与后端 FileProcessingSettings 白名单一致（override 模型 extra="forbid"）。
 */
export interface FileProcessingSettings {
  /**
   * 默认文件编码
   * @values
   * - 'utf-8': UTF-8 编码
   * - 'gbk': GBK 编码（中文 Windows 常用）
   * - 'auto': 自动检测编码
   */
  default_encoding: 'utf-8' | 'gbk' | 'auto'
  /** CSV 字段分隔符 */
  csv_delimiter: string
}

/**
 * 脚本安全设置。
 *
 * 控制 Python 脚本执行的安全策略。
 */
export interface ScriptSecuritySettings {
  /** 是否允许 eval 执行 */
  allow_eval: boolean
  /** 是否允许 exec 执行 */
  allow_exec: boolean
  /** 是否启用沙箱模式 */
  sandbox_mode: boolean
  /** 脚本执行超时时间（秒） */
  timeout_seconds: number
}

/**
 * 项目设置。
 *
 * 包含校验、文件处理和脚本安全三大模块的设置。
 */
export interface ProjectSettings {
  /** 校验设置 */
  validation: ValidationSettings
  /** 文件处理设置 */
  file_processing: FileProcessingSettings
  /** 脚本安全设置 */
  script_security: ScriptSecuritySettings
}

/**
 * 项目清单文件结构（project.precis.yaml）。
 *
 * 项目的入口配置文件，索引所有 Schema、Constraint、Regex、Transform 等资源。
 */
export interface ProjectManifestV2 {
  /** 清单版本号 */
  version: number
  /** 项目基本信息 */
  project: ProjectInfoV2
  /** 项目设置（后端始终返回，前端创建时需提供默认值） */
  settings: ProjectSettings
  /** Schema 资源引用列表 */
  schemas: SchemaRefV2[]
  /** 约束资源引用列表 */
  constraints: ConstraintRefV2[]
  /** Regex 节点资源引用列表 */
  regex_nodes: RegexNodeRefV2[]
  /** Transform 资源引用列表 */
  transforms: TransformRefV2[]
  /** ManualData 内联数据节点资源引用列表（可选） */
  manual_data?: ManualDataRefV2[]
  /** 数据源资源引用列表（可选） */
  data_sources?: DataSourceRefV2[]
  /** 模板资源引用列表（可选） */
  templates?: TemplateRefV2[]
  /** 模板实例列表（可选） */
  template_instances?: TemplateInstanceRefV2[]
  /** 正则模式目录路径 */
  patterns_dir: string
  /** 加载时的警告信息列表 */
  warnings?: string[]
}
