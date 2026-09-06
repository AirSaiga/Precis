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
 * @description graphStore 子模块导出入口
 *
 * 统一导出 graphStore 目录下的所有操作模块，
 * 便于外部模块按需导入。
 *
 * graphStore 是画布图状态管理的核心 Store，负责：
 * - 节点操作（创建、删除、更新、查询）
 * - 边操作（连接、断开、样式控制）
 * - V2 配置导入（Schema、Constraint、Regex）
 * - 画布布局与持久化
 * - 选中状态与交互响应
 */

export { useGraphStore } from '../graphStore'
