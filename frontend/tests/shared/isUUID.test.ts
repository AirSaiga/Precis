import { describe, it, expect } from 'vitest'
import { isUUID } from '@/shared/isUUID'

describe('isUUID', () => {
  describe('标准 UUID 格式 (8-4-4-12)', () => {
    it('标准小写 UUID', () => {
      expect(isUUID('123e4567-e89b-12d3-a456-426614174000')).toBe(true)
    })

    it('标准大写 UUID', () => {
      expect(isUUID('123E4567-E89B-12D3-A456-426614174000')).toBe(true)
    })

    it('标准混合大小写 UUID', () => {
      expect(isUUID('123E4567-e89b-12D3-A456-426614174000')).toBe(true)
    })

    it('全数字 UUID', () => {
      expect(isUUID('12345678-1234-1234-123456789012')).toBe(true)
    })
  })

  describe('变体 UUID 格式 (8-4-4-4-12)', () => {
    it('5 段变体 UUID', () => {
      expect(isUUID('123e4567-e89b-12d3-a456-426614174000')).toBe(true)
    })
  })

  describe('无效输入', () => {
    it('空字符串', () => {
      expect(isUUID('')).toBe(false)
    })

    it('普通文本', () => {
      expect(isUUID('not-a-uuid')).toBe(false)
    })

    it('缺少连字符', () => {
      expect(isUUID('123e4567e89b12d3a456426614174000')).toBe(false)
    })

    it('长度不足', () => {
      expect(isUUID('123e4567-e89b-12d3-a456')).toBe(false)
    })

    it('非十六进制字符', () => {
      expect(isUUID('123e4567-e89b-12d3-a456-42661417400g')).toBe(false)
    })

    it('段数不对 (3 段)', () => {
      expect(isUUID('123e4567-e89b-426614174000')).toBe(false)
    })

    it('段数不对 (6 段)', () => {
      expect(isUUID('1-2-3-4-5-6')).toBe(false)
    })
  })
})
