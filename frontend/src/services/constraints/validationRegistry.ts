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
 * @file validationRegistry.ts
 * @description 约束验证注册表 - 统一导出入口
 *
 * 本文件为向后兼容的 barrel 导出，实际实现已拆分为：
 * - validationRegistryCore.ts: 核心注册表逻辑、类型、辅助函数
 * - validationRegistryHandlers.ts: 各约束类型的验证处理器注册
 */

// 重新导出核心模块的所有符号
export * from './validationRegistryCore'

// side-effect import：触发约束处理器的自注册
import './validationRegistryHandlers'
