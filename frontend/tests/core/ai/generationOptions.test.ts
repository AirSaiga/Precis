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
  })
})
