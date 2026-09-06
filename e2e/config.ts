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
 * E2E 测试全局配置
 *
 * 集中管理后端和前端 URL，避免每个 spec 文件重复定义。
 */

export const BACKEND_URL = process.env.E2E_BACKEND_URL || 'http://localhost:18000'
export const FRONTEND_URL = process.env.E2E_BASE_URL || 'http://localhost:5173'
export const API_PREFIX = '/api/latest'
