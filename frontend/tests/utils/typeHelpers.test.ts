import { describe, it, expect } from 'vitest'
import {
  toBackendType,
  fromBackendType,
  sanitizeV2Id,
  getFileName,
  formatFileSize,
  safeJsonParse,
  generateId,
  isEmpty,
  normalizeSourceKey,
} from '@/utils/typeHelpers'

describe('toBackendType', () => {
  it('String → Str', () => {
    expect(toBackendType('String')).toBe('Str')
  })

  it('Integer → Int', () => {
    expect(toBackendType('Integer')).toBe('Int')
  })

  it('Float → Float', () => {
    expect(toBackendType('Float')).toBe('Float')
  })

  it('Boolean → Str (降级)', () => {
    expect(toBackendType('Boolean')).toBe('Str')
  })

  it('Date → Str (降级)', () => {
    expect(toBackendType('Date')).toBe('Str')
  })

  it('Expression → Expr', () => {
    expect(toBackendType('Expression')).toBe('Expr')
  })

  it('未知类型降级为 Str', () => {
    expect(toBackendType('UnknownType' as any)).toBe('Str')
  })
})

describe('fromBackendType', () => {
  it('Str → String', () => {
    expect(fromBackendType('Str')).toBe('String')
  })

  it('Int → Integer', () => {
    expect(fromBackendType('Int')).toBe('Integer')
  })

  it('Float → Float', () => {
    expect(fromBackendType('Float')).toBe('Float')
  })

  it('Expr → Expression', () => {
    expect(fromBackendType('Expr')).toBe('Expression')
  })

  it('CompositeExpr → Expression', () => {
    expect(fromBackendType('CompositeExpr')).toBe('Expression')
  })

  it('未知类型降级为 String', () => {
    expect(fromBackendType('Unknown')).toBe('String')
  })

  it('非字符串输入降级为 String', () => {
    expect(fromBackendType(123)).toBe('String')
    expect(fromBackendType(null)).toBe('String')
    expect(fromBackendType(undefined)).toBe('String')
    expect(fromBackendType({})).toBe('String')
  })
})

describe('sanitizeV2Id', () => {
  it('将空格替换为下划线', () => {
    expect(sanitizeV2Id('my project')).toBe('my_project')
    expect(sanitizeV2Id('hello world test')).toBe('hello_world_test')
  })

  it('移除不安全字符', () => {
    expect(sanitizeV2Id('path/to/file')).toBe('path_to_file')
    expect(sanitizeV2Id('path\\to\\file')).toBe('path_to_file')
  })

  it('空输入返回 project', () => {
    expect(sanitizeV2Id('')).toBe('project')
  })

  it('去除首尾空白', () => {
    expect(sanitizeV2Id('  my project  ')).toBe('my_project')
  })
})

describe('getFileName', () => {
  it('从路径提取文件名', () => {
    expect(getFileName('data/users.csv')).toBe('users.csv')
    expect(getFileName('C:\\Users\\file.xlsx')).toBe('file.xlsx')
  })

  it('已是文件名的直接返回', () => {
    expect(getFileName('report.csv')).toBe('report.csv')
  })
})

describe('formatFileSize', () => {
  it('0 字节', () => {
    expect(formatFileSize(0)).toBe('0 B')
  })

  it('字节级别', () => {
    expect(formatFileSize(500)).toBe('500 B')
  })

  it('KB 级别', () => {
    expect(formatFileSize(1024)).toBe('1 KB')
    expect(formatFileSize(1536)).toBe('1.5 KB')
  })

  it('MB 级别', () => {
    expect(formatFileSize(1048576)).toBe('1 MB')
  })

  it('GB 级别', () => {
    expect(formatFileSize(1073741824)).toBe('1 GB')
  })
})

describe('safeJsonParse', () => {
  it('合法 JSON 返回解析结果', () => {
    expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 })
    expect(safeJsonParse('[1,2,3]', [])).toEqual([1, 2, 3])
  })

  it('非法 JSON 返回 fallback', () => {
    expect(safeJsonParse('invalid', 'default')).toBe('default')
    expect(safeJsonParse('{broken', [])).toEqual([])
  })
})

describe('generateId', () => {
  it('默认前缀为 id', () => {
    const id = generateId()
    expect(id).toMatch(/^id_\d+_\w+$/)
  })

  it('自定义前缀', () => {
    const id = generateId('node')
    expect(id).toMatch(/^node_\d+_\w+$/)
  })

  it('每次生成不同的 ID', () => {
    const ids = new Set(Array.from({ length: 10 }, () => generateId()))
    expect(ids.size).toBe(10)
  })
})

describe('isEmpty', () => {
  it('null 和 undefined 为空', () => {
    expect(isEmpty(null)).toBe(true)
    expect(isEmpty(undefined)).toBe(true)
  })

  it('空数组为空', () => {
    expect(isEmpty([])).toBe(true)
  })

  it('非空数组不为空', () => {
    expect(isEmpty([1])).toBe(false)
  })

  it('空对象为空', () => {
    expect(isEmpty({})).toBe(true)
  })

  it('非空对象不为空', () => {
    expect(isEmpty({ a: 1 })).toBe(false)
  })

  it('非对象/数组类型不为空', () => {
    expect(isEmpty('hello')).toBe(false)
    expect(isEmpty(0)).toBe(false)
    expect(isEmpty(false)).toBe(false)
  })
})

describe('normalizeSourceKey', () => {
  it('标准化路径和 sheet', () => {
    const [path, sheet] = normalizeSourceKey('data/users.xlsx', 'Sheet1')
    expect(path).toBe('data/users.xlsx')
    expect(sheet).toBe('sheet1')
  })

  it('反斜杠转正斜杠', () => {
    const [path] = normalizeSourceKey('data\\sub\\users.csv', null)
    expect(path).toBe('data/sub/users.csv')
  })

  it('去除 ./ 前缀', () => {
    const [path] = normalizeSourceKey('./data/users.csv', undefined)
    expect(path).toBe('data/users.csv')
  })

  it('空 sheet 统一为 null', () => {
    const [, sheet] = normalizeSourceKey('data/users.csv', '')
    expect(sheet).toBeNull()
  })

  it('统一小写', () => {
    const [path, sheet] = normalizeSourceKey('Data/USERS.XLSX', 'MySheet')
    expect(path).toBe('data/users.xlsx')
    expect(sheet).toBe('mysheet')
  })

  it('解析 .. 路径段与后端 PurePosixPath 一致', () => {
    const [path] = normalizeSourceKey('data/../users.csv', null)
    expect(path).toBe('users.csv')
  })

  it('保留 Windows 驱动器前缀', () => {
    const [path] = normalizeSourceKey('D:\\\\Data\\\\..\\\\users.csv', null)
    expect(path).toBe('d:/users.csv')
  })
})
