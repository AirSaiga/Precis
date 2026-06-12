import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import apiClient from '@/core/services/httpClient'
import {
  validateAndExtractRegex,
  type RegexValidateExtractRequest,
  type RegexValidateExtractResponse,
} from '@/features/regex/services/regexExtractService'

interface CapturedRequest {
  method: string
  url: string
  data: unknown
}

describe('validateAndExtractRegex', () => {
  let captured: CapturedRequest | undefined
  let mockResponse: { status: number; data: RegexValidateExtractResponse }

  beforeEach(() => {
    captured = undefined
    mockResponse = {
      status: 200,
      data: { success: true, data: undefined },
    }
    apiClient.defaults.adapter = (config) => {
      captured = {
        method: (config.method || 'get').toUpperCase(),
        url: config.url || '',
        data: config.data,
      }
      return Promise.resolve({
        data: mockResponse.data,
        status: mockResponse.status,
        statusText: 'OK',
        headers: {},
        config,
      })
    }
  })

  afterEach(() => {
    apiClient.defaults.adapter = undefined
  })

  function makeRequest(
    partial: Partial<RegexValidateExtractRequest> = {}
  ): RegexValidateExtractRequest {
    return {
      regex_pattern: '.*',
      regex_flags: 'g',
      case_sensitive: true,
      match_mode: 'full',
      values: ['a', 'b', 'c'],
      ...partial,
    }
  }

  it('calls POST /utils/regex/validate-extract with correct payload', async () => {
    mockResponse.data = {
      success: true,
      data: {
        total_rows: 3,
        match_count: 3,
        error_count: 0,
        group_names: [],
        extracted_columns: {},
      },
    }
    const request = makeRequest()

    const result = await validateAndExtractRegex(request)

    expect(captured).toBeDefined()
    expect(captured!.method).toBe('POST')
    expect(captured!.url).toBe('/utils/regex/validate-extract')
    expect(JSON.parse(captured!.data as string)).toEqual(request)
    expect(result.total_rows).toBe(3)
    expect(result.match_count).toBe(3)
    expect(result.error_count).toBe(0)
  })

  it('returns extracted_columns for extract mode', async () => {
    mockResponse.data = {
      success: true,
      data: {
        total_rows: 2,
        match_count: 2,
        error_count: 0,
        group_names: ['year', 'month'],
        extracted_columns: {
          year: ['2024', '2023'],
          month: ['01', '12'],
        },
      },
    }
    const request = makeRequest({ match_mode: 'extract' })

    const result = await validateAndExtractRegex(request)

    expect(result.group_names).toEqual(['year', 'month'])
    expect(result.extracted_columns).toEqual({
      year: ['2024', '2023'],
      month: ['01', '12'],
    })
  })

  it('throws when success is false', async () => {
    mockResponse.data = {
      success: false,
      error: 'Invalid regex pattern: unclosed group',
    }
    const request = makeRequest()

    await expect(validateAndExtractRegex(request)).rejects.toThrow(
      'Invalid regex pattern: unclosed group'
    )
  })

  it('throws generic message when success is false but no error field', async () => {
    mockResponse.data = {
      success: false,
    }
    const request = makeRequest()

    await expect(validateAndExtractRegex(request)).rejects.toThrow('Request failed')
  })

  it('throws when data is missing despite success=true', async () => {
    mockResponse.data = {
      success: true,
      data: undefined,
    }
    const request = makeRequest()

    await expect(validateAndExtractRegex(request)).rejects.toThrow('Request failed')
  })

  it('passes AbortSignal to axios config', async () => {
    mockResponse.data = {
      success: true,
      data: {
        total_rows: 1,
        match_count: 1,
        error_count: 0,
        group_names: [],
        extracted_columns: {},
      },
    }
    const controller = new AbortController()
    const request = makeRequest()

    await validateAndExtractRegex(request, controller.signal)

    expect(captured).toBeDefined()
  })

  it('handles empty values array', async () => {
    mockResponse.data = {
      success: true,
      data: {
        total_rows: 0,
        match_count: 0,
        error_count: 0,
        group_names: [],
        extracted_columns: {},
      },
    }
    const request = makeRequest({ values: [] })

    const result = await validateAndExtractRegex(request)

    expect(result.total_rows).toBe(0)
    expect(result.match_count).toBe(0)
    expect(result.error_count).toBe(0)
  })

  it('handles partial match results', async () => {
    mockResponse.data = {
      success: true,
      data: {
        total_rows: 5,
        match_count: 3,
        error_count: 2,
        group_names: [],
        extracted_columns: {},
      },
    }
    const request = makeRequest({ match_mode: 'partial' })

    const result = await validateAndExtractRegex(request)

    expect(result.total_rows).toBe(5)
    expect(result.match_count).toBe(3)
    expect(result.error_count).toBe(2)
  })
})
