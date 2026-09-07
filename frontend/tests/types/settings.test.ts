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
import { describe, expect, it } from 'vitest'
import { defaultProjectSettings } from '@/types/settings'

/**
 * 项目设置默认值与后端契约守卫。
 *
 * 全量校验请求把 settings 原样展开进 override_settings 发给
 * POST /project/validate/full，后端对应 override 模型为 extra="forbid"：
 * 多发任何一个字段整个请求都会被 422 拒绝（2026-09 实证：
 * file_processing 曾超前声明 null_value_strategy/date_format，设置加载
 * 回退默认值时全量校验必现 422）。此处固定三组字段的键集合，
 * 后端模型字段变更时须双向同步后再更新本测试。
 */
describe('defaultProjectSettings 后端契约守卫', () => {
  it('file_processing 键集合与后端 FileProcessingSettings 白名单一致', () => {
    expect(Object.keys(defaultProjectSettings.file_processing).sort()).toEqual([
      'csv_delimiter',
      'default_encoding',
    ])
  })

  it('validation 键集合与后端 ValidationSettingsOverride 白名单一致', () => {
    expect(Object.keys(defaultProjectSettings.validation).sort()).toEqual([
      'auto_validate',
      'batch_max_files',
      'error_handling',
      'strict_mode',
      'timeout_seconds',
    ])
  })

  it('script_security 键集合与后端 ScriptSecuritySettingsOverride 白名单一致', () => {
    expect(Object.keys(defaultProjectSettings.script_security).sort()).toEqual([
      'allow_eval',
      'allow_exec',
      'sandbox_mode',
      'timeout_seconds',
    ])
  })
})
