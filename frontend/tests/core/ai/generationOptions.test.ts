import { describe, it, expect } from 'vitest'
import {
  SAMPLING_PARAM_RANGES,
  createDefaultOptions,
  clampSamplingParam,
  normalizeSamplingOptions,
} from '@/services/ai/generationOptions'

describe('generationOptions', () => {
  describe('SAMPLING_PARAM_RANGES', () => {
    it('should define valid ranges for all sampling params', () => {
      expect(SAMPLING_PARAM_RANGES.sample_rows).toEqual({ min: 10, max: 1000, default: 50 })
      expect(SAMPLING_PARAM_RANGES.sample_values_per_column).toEqual({
        min: 3,
        max: 100,
        default: 10,
      })
      expect(SAMPLING_PARAM_RANGES.max_files).toEqual({ min: 1, max: 200, default: 50 })
      expect(SAMPLING_PARAM_RANGES.max_cell_chars).toEqual({
        min: 50,
        max: 2000,
        default: 200,
      })
    })

    it('should have min <= default <= max for all params', () => {
      for (const [key, range] of Object.entries(SAMPLING_PARAM_RANGES)) {
        expect(range.min, `${key} min`).toBeLessThanOrEqual(range.default)
        expect(range.default, `${key} default`).toBeLessThanOrEqual(range.max)
      }
    })
  })

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

  describe('clampSamplingParam', () => {
    it('should return value within range as-is', () => {
      expect(clampSamplingParam(50, SAMPLING_PARAM_RANGES.sample_rows)).toBe(50)
      expect(clampSamplingParam(100, SAMPLING_PARAM_RANGES.sample_rows)).toBe(100)
    })

    it('should clamp value below min to min', () => {
      expect(clampSamplingParam(5, SAMPLING_PARAM_RANGES.sample_rows)).toBe(10)
      expect(clampSamplingParam(0, SAMPLING_PARAM_RANGES.sample_rows)).toBe(10)
      expect(clampSamplingParam(-10, SAMPLING_PARAM_RANGES.sample_rows)).toBe(10)
    })

    it('should clamp value above max to max', () => {
      expect(clampSamplingParam(2000, SAMPLING_PARAM_RANGES.sample_rows)).toBe(1000)
      expect(clampSamplingParam(9999, SAMPLING_PARAM_RANGES.sample_rows)).toBe(1000)
    })

    it('should return default for non-finite values', () => {
      expect(clampSamplingParam(NaN, SAMPLING_PARAM_RANGES.sample_rows)).toBe(50)
      expect(clampSamplingParam(Infinity, SAMPLING_PARAM_RANGES.sample_rows)).toBe(50)
      expect(clampSamplingParam(-Infinity, SAMPLING_PARAM_RANGES.sample_rows)).toBe(50)
    })

    it('should handle string numbers by coercing', () => {
      expect(clampSamplingParam('80' as unknown as number, SAMPLING_PARAM_RANGES.sample_rows)).toBe(
        80
      )
      expect(clampSamplingParam('5' as unknown as number, SAMPLING_PARAM_RANGES.sample_rows)).toBe(
        10
      )
    })
  })

  describe('normalizeSamplingOptions', () => {
    it('should return defaults when no options provided', () => {
      const result = normalizeSamplingOptions({})
      expect(result.sample_rows).toBe(50)
      expect(result.sample_values_per_column).toBe(10)
      expect(result.max_files).toBe(50)
      expect(result.max_cell_chars).toBe(200)
    })

    it('should keep valid values as-is', () => {
      const result = normalizeSamplingOptions({
        sample_rows: 100,
        sample_values_per_column: 20,
        max_files: 10,
        max_cell_chars: 500,
      })
      expect(result.sample_rows).toBe(100)
      expect(result.sample_values_per_column).toBe(20)
      expect(result.max_files).toBe(10)
      expect(result.max_cell_chars).toBe(500)
    })

    it('should clamp out-of-range values', () => {
      const result = normalizeSamplingOptions({
        sample_rows: 5000,
        sample_values_per_column: 1,
        max_files: 0,
        max_cell_chars: 10,
      })
      expect(result.sample_rows).toBe(1000)
      expect(result.sample_values_per_column).toBe(3)
      expect(result.max_files).toBe(1)
      expect(result.max_cell_chars).toBe(50)
    })

    it('should only override provided values', () => {
      const result = normalizeSamplingOptions({ sample_rows: 200 })
      expect(result.sample_rows).toBe(200)
      expect(result.sample_values_per_column).toBe(10)
      expect(result.max_files).toBe(50)
      expect(result.max_cell_chars).toBe(200)
    })
  })
})
