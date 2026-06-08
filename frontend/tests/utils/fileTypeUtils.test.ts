import { describe, it, expect } from 'vitest'
import {
  detectFileTypeFromExtension,
  detectFileTypeFromPath,
  getFileTypeExtensions,
  isSupportedFileType,
  formatFileTypeLabel,
  getSupportedFileTypes,
} from '@/utils/fileTypeUtils'

describe('detectFileTypeFromExtension', () => {
  it('csv 扩展名返回 csv', () => {
    expect(detectFileTypeFromExtension('csv')).toBe('csv')
  })

  it('xlsx 扩展名返回 excel', () => {
    expect(detectFileTypeFromExtension('xlsx')).toBe('excel')
  })

  it('xls 扩展名返回 excel', () => {
    expect(detectFileTypeFromExtension('xls')).toBe('excel')
  })

  it('json 扩展名返回 json', () => {
    expect(detectFileTypeFromExtension('json')).toBe('json')
  })

  it('大写扩展名也能识别', () => {
    expect(detectFileTypeFromExtension('CSV')).toBe('csv')
    expect(detectFileTypeFromExtension('XLSX')).toBe('excel')
    expect(detectFileTypeFromExtension('JSON')).toBe('json')
  })

  it('未知扩展名返回 unknown', () => {
    expect(detectFileTypeFromExtension('png')).toBe('unknown')
    expect(detectFileTypeFromExtension('txt')).toBe('unknown')
    expect(detectFileTypeFromExtension('xml')).toBe('unknown')
  })

  it('空字符串返回 unknown', () => {
    expect(detectFileTypeFromExtension('')).toBe('unknown')
  })
})

describe('detectFileTypeFromPath', () => {
  it('从简单文件名检测', () => {
    expect(detectFileTypeFromPath('data.csv')).toBe('csv')
    expect(detectFileTypeFromPath('report.xlsx')).toBe('excel')
    expect(detectFileTypeFromPath('config.json')).toBe('json')
  })

  it('从带路径的文件名检测', () => {
    expect(detectFileTypeFromPath('data/users.xlsx')).toBe('excel')
    expect(detectFileTypeFromPath('/var/data/report.CSV')).toBe('csv')
    expect(detectFileTypeFromPath('C:\\Users\\data\\config.JSON')).toBe('json')
  })

  it('多扩展名取最后一个', () => {
    expect(detectFileTypeFromPath('data.backup.json')).toBe('json')
    expect(detectFileTypeFromPath('report.final.csv')).toBe('csv')
  })

  it('无扩展名返回 unknown', () => {
    expect(detectFileTypeFromPath('data')).toBe('unknown')
    expect(detectFileTypeFromPath('/path/to/file')).toBe('unknown')
  })

  it('无效输入返回 unknown', () => {
    expect(detectFileTypeFromPath('')).toBe('unknown')
    expect(detectFileTypeFromPath(undefined as any)).toBe('unknown')
    expect(detectFileTypeFromPath(null as any)).toBe('unknown')
  })
})

describe('getFileTypeExtensions', () => {
  it('csv 类型返回 [csv]', () => {
    expect(getFileTypeExtensions('csv')).toEqual(['csv'])
  })

  it('excel 类型返回 [xlsx, xls]', () => {
    const result = getFileTypeExtensions('excel')
    expect(result).toContain('xlsx')
    expect(result).toContain('xls')
    expect(result).toHaveLength(2)
  })

  it('json 类型返回 [json]', () => {
    expect(getFileTypeExtensions('json')).toEqual(['json'])
  })

  it('unknown 类型返回空数组', () => {
    expect(getFileTypeExtensions('unknown')).toEqual([])
  })
})

describe('isSupportedFileType', () => {
  it('支持的文件类型返回 true', () => {
    expect(isSupportedFileType('data.csv')).toBe(true)
    expect(isSupportedFileType('data.xlsx')).toBe(true)
    expect(isSupportedFileType('data.xls')).toBe(true)
    expect(isSupportedFileType('data.json')).toBe(true)
  })

  it('不支持的文件类型返回 false', () => {
    expect(isSupportedFileType('image.png')).toBe(false)
    expect(isSupportedFileType('readme.md')).toBe(false)
    expect(isSupportedFileType('unknown')).toBe(false)
  })

  it('空字符串返回 false', () => {
    expect(isSupportedFileType('')).toBe(false)
  })
})

describe('formatFileTypeLabel', () => {
  it('小写输入转为大写', () => {
    expect(formatFileTypeLabel('csv')).toBe('CSV')
    expect(formatFileTypeLabel('excel')).toBe('EXCEL')
    expect(formatFileTypeLabel('json')).toBe('JSON')
    expect(formatFileTypeLabel('unknown')).toBe('UNKNOWN')
  })
})

describe('getSupportedFileTypes', () => {
  it('返回去重后的支持类型', () => {
    const types = getSupportedFileTypes()
    expect(types).toContain('csv')
    expect(types).toContain('excel')
    expect(types).toContain('json')
    expect(types).not.toContain('unknown')
    expect(types.length).toBeGreaterThanOrEqual(3)
  })
})
