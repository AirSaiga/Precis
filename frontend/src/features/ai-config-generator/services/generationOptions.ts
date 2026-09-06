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
 * @file generationOptions.ts
 * @description AI 配置生成选项的默认值
 *
 * 高级参数（采样范围、校验等）已随 OptionsPanel 移除，
 * 现在只保留默认选项的创建。
 */

import type { AiGenerateV2ConfigOptions } from '@/types/ai'

/** 创建默认生成选项 */
export function createDefaultOptions(): AiGenerateV2ConfigOptions {
  return {
    sample_rows: 50,
    sample_values_per_column: 10,
    max_files: 50,
    max_cell_chars: 200,
    generate_schemas: true,
    generate_constraints: true,
    generate_regex_nodes: true,
    keep_existing: true,
    agent_mode: true,
    max_iterations: 2,
    validation_sample_size: 1000,
    auto_chunking: true,
    chunk_max_columns: 20,
    chunk_max_files: 5,
  }
}
