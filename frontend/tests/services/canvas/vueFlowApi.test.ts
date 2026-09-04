import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  initVueFlowApi,
  resetVueFlowApi,
  addNodes,
  addEdges,
  removeNodes,
  removeEdges,
  updateNodeInternals,
  updateEdgeData,
  findEdge,
} from '@/services/canvas/vueFlowApi'
import type { VueFlowApi } from '@/services/canvas/vueFlowApi'

function makeMockApi(): VueFlowApi {
  return {
    addNodes: vi.fn(),
    addEdges: vi.fn(),
    removeNodes: vi.fn(),
    removeEdges: vi.fn(),
    updateNodeInternals: vi.fn(),
    updateEdgeData: vi.fn(),
    findEdge: vi.fn(),
  }
}

describe('vueFlowApi', () => {
  let api: VueFlowApi

  beforeEach(() => {
    api = makeMockApi()
    initVueFlowApi(api)
  })

  describe('未初始化时调用', () => {
    it('抛出错误', () => {
      initVueFlowApi(null as any)
      expect(() => addNodes([])).toThrow('[vueFlowApi]')
      expect(() => addEdges([])).toThrow('[vueFlowApi]')
      expect(() => removeNodes([])).toThrow('[vueFlowApi]')
      expect(() => removeEdges([])).toThrow('[vueFlowApi]')
      expect(() => updateNodeInternals('id')).toThrow('[vueFlowApi]')
      expect(() => updateEdgeData('id', {})).toThrow('[vueFlowApi]')
      expect(() => findEdge('id')).toThrow('[vueFlowApi]')
    })
  })

  describe('owner token（DEF-11 关联：旧实例晚到的卸载不得打空新实例的 API）', () => {
    it('持有正确 owner 的 reset 正常置空', () => {
      const owner = initVueFlowApi(api)
      resetVueFlowApi(owner)
      expect(() => addNodes([])).toThrow('[vueFlowApi]')
    })

    it('owner 不匹配时 reset 跳过置空（新实例已重新注入的场景）', () => {
      const firstOwner = initVueFlowApi(api)
      // 新实例（重建窗口期：新 setup 已注入，旧实例才卸载）
      const api2 = makeMockApi()
      initVueFlowApi(api2)
      // 旧实例晚到的卸载，带着自己的旧 owner
      resetVueFlowApi(firstOwner)
      // 新实例的 API 不应被打空
      const nodes = [{ id: 'n1', type: 'schema' }] as any
      addNodes(nodes)
      expect(api2.addNodes).toHaveBeenCalledWith(nodes)
    })

    it('无参 reset 保持既有行为（无条件置空）', () => {
      initVueFlowApi(api)
      resetVueFlowApi()
      expect(() => addNodes([])).toThrow('[vueFlowApi]')
    })
  })

  describe('addNodes', () => {
    it('调用底层 api.addNodes', () => {
      const nodes = [{ id: 'n1', type: 'schema' }] as any
      addNodes(nodes)
      expect(api.addNodes).toHaveBeenCalledWith(nodes)
    })
  })

  describe('addEdges', () => {
    it('调用底层 api.addEdges', () => {
      const edges = [{ id: 'e1', source: 'n1', target: 'n2' }] as any
      addEdges(edges)
      expect(api.addEdges).toHaveBeenCalledWith(edges)
    })
  })

  describe('removeNodes', () => {
    it('调用底层 api.removeNodes', () => {
      removeNodes(['n1'])
      expect(api.removeNodes).toHaveBeenCalledWith(['n1'])
    })
  })

  describe('removeEdges', () => {
    it('调用底层 api.removeEdges', () => {
      removeEdges(['e1'])
      expect(api.removeEdges).toHaveBeenCalledWith(['e1'])
    })
  })

  describe('updateNodeInternals', () => {
    it('调用底层 api.updateNodeInternals', () => {
      updateNodeInternals('n1')
      expect(api.updateNodeInternals).toHaveBeenCalledWith('n1')
    })
  })

  describe('updateEdgeData', () => {
    it('调用底层 api.updateEdgeData', () => {
      updateEdgeData('e1', { animated: true })
      expect(api.updateEdgeData).toHaveBeenCalledWith('e1', { animated: true })
    })
  })

  describe('findEdge', () => {
    it('调用底层 api.findEdge 并返回结果', () => {
      const mockEdge = { id: 'e1', source: 'n1', target: 'n2' }
      ;(api.findEdge as any).mockReturnValue(mockEdge)
      const result = findEdge('e1')
      expect(api.findEdge).toHaveBeenCalledWith('e1')
      expect(result).toBe(mockEdge)
    })

    it('返回 undefined 当边不存在', () => {
      ;(api.findEdge as any).mockReturnValue(undefined)
      const result = findEdge('nonexistent')
      expect(result).toBeUndefined()
    })
  })
})
