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
 * @file index.ts
 * @description V2 项目配置 API 统一导出入口（barrel）
 *
 * 该模块封装后端 /project/* 接口，按领域拆分为多个子文件：
 * - shared: 共享错误类型与工具
 * - manifest: 项目清单
 * - fullConfig: 全量配置
 * - schema: 表结构
 * - constraint: 约束
 * - regex/transform: 正则/转换节点
 * - pattern: 模式
 * - projectView: 项目视图
 * - template: 模板
 * - settings: 设置
 * - workspaces: 工作区
 *
 * 导入示例：
 *   import { getV2Schema, ProjectNotFoundError } from '@/api/projectV2Api'
 */

export * from './shared'
export * from './manifest'
export * from './fullConfig'
export * from './schema'
export * from './constraint'
export * from './regex'
export * from './transform'
export * from './pattern'
export * from './projectView'
export * from './template'
export * from './settings'
export * from './workspaces'
