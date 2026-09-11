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
 * @fileoverview V2 项目配置类型入口（barrel）——按实体域聚合导出 projectV2/ 下的
 * 全部类型，消费方统一从 '@/types/projectV2' 导入。
 *
 * 与后端 backend/app/core/project/ 目录保持结构一致，用于：
 * - Graph ⇄ V2 配置的序列化/反序列化
 * - V2 API 调用的请求/响应类型
 *
 * 字段层级说明：
 * - L1（核心）：用户必须理解的字段
 * - L2（可选）：用户可能需要调整的字段
 * - L3（内部）：程序生成，人为编辑可忽略
 *
 * 约束配置说明：
 * 支持两种约束配置方式：
 * 1. 独立文件：constraints/*.constraint.yaml
 * 2. 内嵌约束：直接在 schema.yaml 的 constraints 字段中定义
 */

export * from './projectV2/dataSources'
export * from './projectV2/schema'
export * from './projectV2/constraints'
export * from './projectV2/regex'
export * from './projectV2/transform'
export * from './projectV2/manualData'
export * from './projectV2/templates'
export * from './projectV2/manifest'
export * from './projectV2/inspection'
export * from './projectV2/fullConfig'
export * from './projectV2/workspaces'
export * from './projectV2/validationTask'
