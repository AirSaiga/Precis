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
 * @fileoverview V2 配置自检类型：自检问题（后端 LoadingError.to_dict 直序列化）、
 * 可执行动作与一键修复 API 描述。
 */

/**
 * 配置自检 — 可执行动作
 *
 * 前端 InspectionDrawer 根据 type 渲染对应按钮：
 * - open_file : 调 Electron IPC 打开本地文件（或 fallback 到复制路径）
 * - copy      : 把 payload.text 写入剪贴板
 * - dismiss   : 局部"忽略"动作（持久化到 localStorage）
 * - auto_fix  : 调后端 fix_api 描述的接口执行一键修复
 * - navigate  : 跳转到画布/资源树等其他位置
 */
export interface InspectionAction {
  type: 'open_file' | 'copy' | 'dismiss' | 'auto_fix' | 'navigate'
  label: string
  /** i18n key，前端优先使用此字段渲染（缺失时 fallback 到 label） */
  label_key?: string
  /** open_file / copy 使用 */
  file_path?: string
  /** copy 使用 */
  text?: string
  /** navigate 使用 */
  target?: string
  /** auto_fix 使用：用于匹配前端的 fix handler */
  fix_kind?: string
  /** auto_fix 使用：附加参数 */
  payload?: Record<string, unknown>
}

/**
 * 一键修复 API 描述
 *
 * 前端 auto_fix 动作处理器读取此字段，调用对应后端 API。
 * 出于安全考虑，仅"安全操作"（不破坏数据）会填充此字段。
 */
export interface InspectionFixApi {
  method: 'POST' | 'PUT' | 'DELETE'
  path: string
  body?: Record<string, unknown>
}

/**
 * 单条配置自检问题
 *
 * 后端 LoadingError.to_dict() 直接序列化为此结构。
 * 前端可零成本展示 title / description / fix_hint，无需翻译错误类型。
 *
 * i18n 支持：当 *_key 字段存在时，前端用 t(key, message_params) 渲染；
 * 否则 fallback 到对应的中文字符串字段。
 */
export interface InspectionIssue {
  /** 稳定唯一 id，用于"忽略"持久化 */
  id: string
  /** 严重度：blocker=阻塞、warning=警告、info=提示 */
  severity: 'blocker' | 'warning' | 'info'
  /** 人类可读短标题（中文 fallback） */
  title: string
  /** 根因说明（中文 fallback） */
  description: string
  /** 高亮显示的修复建议（中文 fallback） */
  fix_hint: string
  /** 原始错误类型（保留用于日志/高级用户排查） */
  error_type: string
  /** 出错的文件路径 */
  file_path: string
  /** 涉及的资源 id（可能为 null） */
  ref_id: string | null
  /** 后端原始 message（保留向后兼容） */
  message: string
  /** 后端原始 suggestion（保留向后兼容） */
  suggestion: string
  /** 可执行动作列表 */
  actions: InspectionAction[]
  /** 一键修复 API 描述（仅安全操作） */
  fix_api?: InspectionFixApi
  /** 上下文数据，用于渲染对比表（如 available_schemas、available_columns 等） */
  context?: Record<string, unknown>
  /** i18n key for title（可选，存在时前端优先用 i18n 渲染） */
  title_key?: string
  /** i18n key for description（可选） */
  description_key?: string
  /** i18n key for fix_hint（可选） */
  fix_hint_key?: string
  /** i18n 插值参数（如 {constraintId, tableId, columnId}） */
  message_params?: Record<string, unknown>
}

/**
 * 配置自检完整结果
 */
export interface InspectionResultV2 {
  /** 自检执行时间（ISO 字符串） */
  inspected_at: string
  /** 自检发现的所有问题（已按类型合并/排序） */
  errors: InspectionIssue[]
}
