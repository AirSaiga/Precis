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
import { describe, it, expect } from 'vitest'
import { createDefaultOptions } from '@/features/ai-config-generator/services/generationOptions'

describe('generationOptions', () => {
  describe('createDefaultOptions', () => {
    it('should return default options with correct sampling values', () => {
      const opts = createDefaultOptions()
      expect(opts.sample_rows).toBe(50)
      expect(opts.sample_values_per_column).toBe(10)
      expect(opts.max_files).toBe(50)
      expect(opts.max_cell_chars).toBe(200)
      expect(opts.generate_schemas).toBe(true)
      expect(opts.generate_constraints).toBe(true)
      expect(opts.generate_regex_nodes).toBe(true)
      expect(opts.keep_existing).toBe(true)
    })

    it('should enable agent mode by default', () => {
      const opts = createDefaultOptions()
      expect(opts.agent_mode).toBe(true)
      expect(opts.max_iterations).toBe(2)
      expect(opts.validation_sample_size).toBe(1000)
      expect(opts.auto_chunking).toBe(true)
      expect(opts.chunk_max_columns).toBe(20)
      expect(opts.chunk_max_files).toBe(5)
    })
  })
})
