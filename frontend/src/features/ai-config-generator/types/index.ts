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
 * @file AI 配置生成器 Feature 类型导出
 *
 * Re-export 自共享 types/ai.ts 中的生成器相关类型，
 * 方便 feature 内部引用。
 */
export type {
  AiGenerateV2ConfigOptions,
  AiGenerateV2ConfigRequest,
  AiGenerateV2ConfigResponse,
  AiGenerateV2ConfigJobCreateResponse,
  AiGenerateV2ConfigJobStatusValue,
  AiGenerateV2ConfigJobStatus,
  CloudAIProviderResponse,
  CloudAIProviderTestResponse,
  CreateProviderRequest,
  UpdateProviderRequest,
  ProviderPreset,
} from '@/types/ai'
