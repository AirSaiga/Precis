/**
 * @file connectionRulesApi.ts
 * @description 画布连接规则 API
 *
 * 封装后端 `/project/connection-rules` 接口，用于获取和更新
 * 画布节点连接规则配置（哪些节点类型可以连接到哪些节点类型）。
 *
 * 功能概述：
 * - getConnectionRules: 获取当前项目的连接规则列表
 * - updateConnectionRules: 更新连接规则配置
 * - FrontendConnectionRule: 前端连接规则类型定义
 */

import type { ConnectionRule } from '@/services/rules'

const API_BASE = '/api'

interface EndpointConfig {
  node_types: string[]
  handles?: string[]
}

interface RuleConfig {
  allow_multiple?: boolean
  validation_mode?: 'strict' | 'loose'
}

export interface FrontendConnectionRule {
  id: string
  name: string
  source: EndpointConfig
  target: EndpointConfig
  config?: RuleConfig
}

export interface ConnectionRulesResponse {
  version: string
  rules: FrontendConnectionRule[]
}

async function getHeaders(): Promise<Headers> {
  const headers = new Headers()
  const projectStore = useProjectStore()
  if (projectStore.currentPaths?.project) {
    headers.set('X-Project-Config-Path', projectStore.currentPaths.project)
  }
  return headers
}

function getBackendUrl(path: string): string {
  return `${API_BASE}${path}`
}

export async function fetchConnectionRules(): Promise<ConnectionRulesResponse> {
  const response = await fetch(getBackendUrl('/connection-rules'), {
    headers: await getHeaders(),
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch connection rules: ${response.statusText}`)
  }

  return response.json()
}

export async function saveConnectionRules(rules: ConnectionRulesResponse): Promise<void> {
  const response = await fetch(getBackendUrl('/connection-rules'), {
    method: 'PUT',
    headers: {
      ...(await getHeaders()),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(rules),
  })

  if (!response.ok) {
    throw new Error(`Failed to save connection rules: ${response.statusText}`)
  }
}

export async function resetConnectionRules(): Promise<void> {
  const response = await fetch(getBackendUrl('/connection-rules/reset'), {
    method: 'POST',
    headers: await getHeaders(),
  })

  if (!response.ok) {
    throw new Error(`Failed to reset connection rules: ${response.statusText}`)
  }
}

function useProjectStore() {
  return {
    get currentPaths(): { project?: string } {
      try {
        const stored = localStorage.getItem('precis_config')
        if (stored) {
          const config = JSON.parse(stored)
          return { project: config.configPath || config.config_path }
        }
      } catch {
        return {}
      }
      return {}
    },
  }
}
