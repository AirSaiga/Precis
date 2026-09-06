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
 * @file validationApi.ts
 * @description 数据校验 API 服务模块 - 统一导出入口
 *
 * 本模块已拆分为子模块：
 * - ./validation/core.ts: 共享类型定义和常量
 * - ./validation/basic.ts: 基础校验函数（非空、范围、唯一性）
 * - ./validation/advanced.ts: 高级校验函数（允许值、条件、外键、脚本、字符集）
 * - ./validation/inline.ts: 行内数据校验（TransformOutput / ManualData）
 */

export * from './validation/core'
export * from './validation/basic'
export * from './validation/advanced'
export * from './validation/inline'
