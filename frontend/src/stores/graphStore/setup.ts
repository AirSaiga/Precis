/**
 * @file graphStore.ts
 * @description 图数据状态管理主 Store（God Store）
 *
 * 该 Store 是前端画布系统的核心状态管理中心，负责 orchestrate 数据流图中的
 * 所有节点、边、资产、项目状态和交互状态。
 *
 * 功能概述：
 * 1. 节点管理 — 增删改查画布中的所有节点（Schema、SourcePreview、Regex、Constraint、TableSet 等）
 * 2. 边管理 — 创建、删除、验证节点间的连接关系
 * 3. 资产数据 — 管理表结构、数据源预览、校验结果等业务数据
 * 4. 项目生命周期 — 创建、加载、保存、清空项目
 * 5. 交互状态 — 选中节点、框选、拖拽、剪贴板、撤销/重做
 * 6. UI 状态 — Regex 设计模态框、校验报告面板、设计面板显隐
 * 7. V2 配置引擎 — 与后端 V2 项目配置的序列化/反序列化
 *
 * 架构设计：
 * - 采用 Pinia Setup Store 模式，使用 ref/computed 定义响应式状态
 * - 通过子模块工厂函数（createXxxModule）拆分职责，降低单文件复杂度：
 *   - history: 撤销/重做栈
 *   - selection: 节点选中与框选
 *   - v2Import: V2 配置导入画布
 *   - v2Persistence: V2 配置持久化保存
 *   - clipboard: 节点复制粘贴
 *   - pathing: 项目路径管理
 *   - connectionOps: 边的增删改查
 *   - yamlIO: YAML 导入导出
 *   - projectLifecycle: 项目创建/加载/清空
 *   - factories: 各类节点工厂（schema/constraint/regex/library/misc/jsonSchema）
 *   - schemaOps: Schema 节点 CRUD 操作
 *   - regexDesign: Regex 设计面板状态
 *   - assets: 资源树管理
 *   - scope: 节点作用域/可见性管理
 * - 子模块通过依赖注入获取核心状态引用（nodes, edges, 等），实现松耦合
 *
 * 核心状态切片：
 * - nodes / edges: Vue Flow 节点和边数组
 * - selectedNodeId / selectedNodeIds: 单选/多选状态
 * - isProjectLoaded / saveState: 项目加载和保存状态
 * - designModalVisible / activeRegexNodeId: UI 模态框状态
 * - lastFullValidationSummary: 最近一次全量校验结果
 * - copiedNodes: 剪贴板数据
 *
 * 输入示例：
 *   const graphStore = useGraphStore()
 *   graphStore.loadProject('/path/to/project.precis.yaml')
 *
 * 输出示例：
 *   graphStore.nodes.value  // CustomNode[] — 当前画布所有节点
 *   graphStore.saveState.value // 'saved' | 'unsaved' | 'error'
 */

import { ref, computed, watch, nextTick } from 'vue'
import type { Edge } from '@vue-flow/core'
import type {
  CustomNode,
  CustomNodeData,
  SchemaNodeData,
  TableAsset,
  RegexNodeData,
} from '@/types/graph'
import type { FullValidationSummary, ValidationStatistics } from '../../api/projectValidationApi'
import { addNodes, removeNodes, removeEdges } from '@/services/canvas/vueFlowApi'

// ===== 纯数组工具函数（原 nodeOperations.ts 中唯一存活的 1 个函数）=====

function updateNodeDataInArray(
  nodes: CustomNode[],
  nodeId: string,
  data: Partial<CustomNode['data']>
): CustomNode[] {
  return nodes.map((node) => {
    if (node.id === nodeId) {
      return { ...node, data: { ...node.data, ...data } } as CustomNode
    }
    return node
  })
}

import { createHistoryModule } from './modules/history'
import { createSelectionModule } from './modules/selection'
import { createV2ImportModule } from './modules/v2Import'
import { createV2PersistenceModule } from './modules/v2Persistence'
import { createClipboardModule } from './modules/clipboard'
import { createPathingModule } from './modules/pathing'
import { createConnectionOpsModule } from './modules/connectionOps'
import { createConnectionStateSyncModule } from './modules/connectionStateSync'
import { createYamlIOModule } from './modules/yamlIO'
import { createProjectLifecycleModule } from './modules/projectLifecycle'
import { createSchemaFactoryModule } from './modules/factories/schemaFactory'
import { createConstraintFactoryModule } from './modules/factories/constraintFactory'
import { createRegexFactoryModule } from './modules/factories/regexFactory'
import { createTransformFactoryModule } from './modules/factories/transformFactory'
import { createTransformOutputFactoryModule } from './modules/factories/transformOutputFactory'
import { createManualDataFactoryModule } from './modules/factories/manualDataFactory'
import { createLibraryNodesFactoryModule } from './modules/factories/libraryNodesFactory'
import { createMiscFactoryModule } from './modules/factories/miscFactory'
import { createJsonSchemaFactoryModule } from './modules/factories/jsonSchemaFactory'
import { createTemplateInstanceFactoryModule } from './modules/factories/templateInstanceFactory'
import { createTemplateExpandModule } from './modules/templateExpand'
import { createSchemaOpsModule } from './modules/schemaOps'
import { createRegexDesignModule } from './modules/regexDesign'
import { createAssetsModule } from './modules/assets'
import { createScopeModule } from './modules/scope'
import '@/services/disconnect' // side-effect: 触发所有断开清理处理器的自注册
import { isConstraintNodeType, validateForInlineSource } from '@/services/constraints/validationRegistry'
import { logger } from '@/core/utils/logger'
import {
  listV2Templates,
  getV2Template,
  createV2Template,
  updateV2Template,
  deleteV2Template,
  expandV2Template,
} from '@/api/projectV2Api'

/**
 * Graph Store 主定义
 *
 * 通过 defineStore 注册为 Pinia Store，使用 Setup Store 模式。
 * 所有子模块在此实例化并聚合导出。
 */
export function setupGraphStore() {
  // =====================================
  // 工具函数
  // =====================================

  // =====================================
  // 核心状态定义
  // =====================================

  /**
   * 图中所有节点的列表
   *
   * 节点是数据流图的基本元素，每个节点包含：
   * - id: 唯一标识符
   * - type: 节点类型（schema、sourcePreview、regex、constraint等）
   * - position: 节点在画布上的位置坐标
   * - data: 节点的业务数据
   */
  const nodes = ref<CustomNode[]>([])

  /**
   * 图中所有边的列表
   *
   * 边表示节点之间的连接关系，每条边包含：
   * - id: 唯一标识符
   * - source: 源节点 ID
   * - target: 目标节点 ID
   * - sourceHandle: 源连接点 ID
   * - targetHandle: 目标连接点 ID
   */
  const edges = ref<Edge[]>([])

  /**
   * 表资产列表
   *
   * 存储项目的表结构定义等业务数据
   * 用于资产库的数据展示和管理
   */
  const assets = ref<TableAsset[]>([])

  /**
   * 当前选中节点的 ID
   *
   * 用于追踪用户在画布上选中的节点，
   * 为属性检查器提供数据
   * null 表示没有选中的节点
   */
  const selectedNodeId = ref<string | null>(null)

  /**
   * 多选节点 ID 列表
   *
   * 用于 Shift+框选时存储多个选中节点的 ID
   * 支持批量操作（拖拽、移动、删除）
   */
  const selectedNodeIds = ref<string[]>([])

  /**
   * 框选区域信息
   *
   * 存储当前框选区域的坐标和尺寸
   * 用于 Shift+拖拽框选多个节点
   * x, y: 起始坐标
   * width, height: 区域宽高（可正可负）
   */
  const selectionBox = ref<{ x: number; y: number; width: number; height: number } | null>(null)

  /**
   * V2 Schema ID 映射表
   *
   * 当画布节点使用 UUID（而非 V2 ID）时，通过此映射表关联到 V2 配置。
   * 键：画布节点 ID（UUID）
   * 值：V2 Schema ID（sc_...）
   *
   * 注意：此 Map 仅用于命令式查询（resolveV2SchemaId），无模板/computed 依赖，
   * 因此 .set() 原地修改不触发响应性是可接受的。若未来需要响应式依赖，
   * 应改用 v2SchemaIdMap.value = new Map([...v2SchemaIdMap.value, [key, value]])。
   */
  const v2SchemaIdMap = ref<Map<string, string>>(new Map())

  /**
   * 是否正在框选模式
   *
   * 标记当前是否处于 Shift+拖拽框选状态
   */
  const isSelecting = ref(false)

  /**
   * 复制的节点列表
   *
   * 用于存储通过 Ctrl/Cmd+C 或 Ctrl/Cmd+D 复制的节点数据
   * 内部使用，不暴露到外部
   */
  const copiedNodes = ref<CustomNode[]>([])

  /**
   * 粘贴时的位置偏移量
   *
   * 用于控制新节点与原节点之间的位置偏移
   */
  const pasteOffset = { x: 20, y: 20 }

  // =====================================
  // 正则表达式设计弹窗状态
  // =====================================

  /**
   * 正则设计弹窗是否可见
   *
   * 用于控制正则表达式编辑器的显示/隐藏
   */
  const designModalVisible = ref(false)

  /**
   * 当前激活编辑的正则节点 ID
   *
   * 记录正在编辑的正则表达式节点，
   * 用于编辑器加载对应节点的配置
   */
  const activeRegexNodeId = ref<string | null>(null)

  /**
   * 正则编辑时的示例数据
   *
   * 用于在正则编辑器中展示列的实际值，
   * 帮助用户编写和调试正则表达式
   */
  const regexEditSampleData = ref<string>('')

  // =====================================
  // 项目状态
  // =====================================

  /**
   * 项目是否已加载
   *
   * 标识当前是否有打开的项目，
   * 未加载项目时画布显示启动界面
   */
  const isProjectLoaded = ref(false)

  /**
   * 当前项目名称
   */
  const projectName = ref('')

  /**
   * 项目配置统计摘要
   *
   * 存储从 project.yaml 配置中直接读取的统计信息，
   * 即使画布被清空或部分加载，该统计依然准确反映项目全貌。
   */
  const projectConfigStats = ref({
    schemaCount: 0,
    constraintCount: 0,
    constraintStandaloneCount: 0,
    constraintInlineCount: 0,
    regexCount: 0,
    transformCount: 0,
    templateCount: 0,
  })

  /**
   * 项目配置统计是否已加载
   *
   * 用于区分“尚未读取配置（默认 0）”与“配置真实统计为 0”的情况，
   * 避免 ProjectConsole 节点错误回退到画布节点数量。
   */
  const projectConfigStatsLoaded = ref(false)

  /**
   * 最近一次用于统计的配置目录
   *
   * 用于避免在同一配置路径下重复请求全量配置。
   */
  const projectConfigStatsConfigPath = ref('')

  /**
   * 最近一次全量校验摘要
   *
   * 由 FullValidationModal 在运行完成后写入，用于在项目控制台等位置展示概览指标。
   */
  const lastFullValidationSummary = ref<FullValidationSummary | null>(null)

  /**
   * 最近一次全量校验详细统计
   *
   * 包含通过率等详细统计信息
   */
  const lastFullValidationStatistics = ref<ValidationStatistics | null>(null)

  /**
   * 更新最近一次全量校验摘要
   */
  const setLastFullValidationSummary = (summary: FullValidationSummary | null) => {
    lastFullValidationSummary.value = summary
  }

  /**
   * 更新最近一次全量校验详细统计
   */
  const setLastFullValidationStatistics = (statistics: ValidationStatistics | null) => {
    lastFullValidationStatistics.value = statistics
  }

  // =====================================
  // 计算属性
  // =====================================

  /**
   * 当前选中的节点
   *
   * 根据 selectedNodeId 在节点列表中查找对应的节点
   * 如果未找到返回 null
   */
  const selectedNode = computed(() => {
    return nodes.value.find((node) => node.id === selectedNodeId.value) || null
  })

  /**
   * 所有选中的节点列表
   *
   * 根据 selectedNodeIds 在节点列表中查找所有选中的节点
   * 如果未找到返回空数组
   */
  const selectedNodes = computed(() => {
    return nodes.value.filter((node) => selectedNodeIds.value.includes(node.id))
  })

  /**
   * 是否有多个节点被选中
   */
  const hasMultipleSelection = computed(() => {
    return selectedNodeIds.value.length > 1
  })

  /**
   * 当前激活的正则节点
   *
   * 根据 activeRegexNodeId 在节点列表中查找对应的正则节点
   * 用于正则编辑器的数据绑定
   */
  const activeRegexNode = computed(() => {
    if (!activeRegexNodeId.value) return null
    return nodes.value.find((node) => node.id === activeRegexNodeId.value) || null
  })

  // --- 项目管理 ---

  const { normalizeConfigDir, resolveProjectRelativePath, getEffectiveProjectConfigPath } =
    createPathingModule({
      nodes,
    })

  // --- 连接状态同步模块（统一管理 parent/children/outputPortConnected） ---
  const connectionStateSync = createConnectionStateSyncModule({
    nodes,
    edges,
    updateNodeData,
  })

  const { importV2ResourceToCanvas } = createV2ImportModule({
    nodes,
    edges,
    selectedNodeId,
    getEffectiveProjectConfigPath,
    resolveProjectRelativePath,
    reconcileAll: connectionStateSync.reconcileAll,
  })

  const { createSchemaNode, addColumnToSchema } = createSchemaFactoryModule({
    nodes,
    selectedNodeId,
  })
  const { createConstraintNode } = createConstraintFactoryModule({ nodes, selectedNodeId })
  const { createRegexNode } = createRegexFactoryModule({ nodes, selectedNodeId })
  const { createTransformNode } = createTransformFactoryModule({ nodes, selectedNodeId })
  const { createTransformOutputNode } = createTransformOutputFactoryModule({ nodes })
  const { createManualDataNode } = createManualDataFactoryModule({ nodes, selectedNodeId })
  const { createPatternToolboxNode, createConstraintDashboardNode } =
    createLibraryNodesFactoryModule({
      nodes,
      selectedNodeId,
      getEffectiveProjectConfigPath,
    })
  const { createEmptyTableNode, createEmptyPatternNode, createLogicNode } = createMiscFactoryModule(
    {
      createSchemaNode,
      createRegexNode,
      createConstraintNode,
    }
  )

  const { createJsonSchemaNode, createJsonSourcePreviewNode } = createJsonSchemaFactoryModule({
    nodes,
    selectedNodeId,
  })

  const { createTemplateInstanceNode } = createTemplateInstanceFactoryModule({
    nodes,
    selectedNodeId,
  })

  const templateExpand = createTemplateExpandModule({
    nodes,
    edges,
    updateNodeData,
  })

  const v2Persistence = createV2PersistenceModule({
    nodes,
    edges,
    selectedNodeId,
    projectName,
    isProjectLoaded,
    projectConfigStats,
    projectConfigStatsLoaded,
    projectConfigStatsConfigPath,
    lastFullValidationSummary,
    lastFullValidationStatistics,
    normalizeConfigDir,
    getEffectiveProjectConfigPath,
    resolveProjectRelativePath,
    updateNodeData,
  })

  const projectLifecycle = createProjectLifecycleModule({
    nodes,
    edges,
    assets,
    selectedNodeId,
    selectedNodeIds,
    selectionBox,
    projectName,
    isProjectLoaded,
    projectConfigStats,
    projectConfigStatsLoaded,
    projectConfigStatsConfigPath,
    lastFullValidationSummary,
    lastFullValidationStatistics,
    designModalVisible,
    activeRegexNodeId,
    regexEditSampleData,
    copiedNodes,
    normalizeConfigDir,
    refreshProjectConfigStats: v2Persistence.refreshProjectConfigStats,
  })

  const {
    createProject,
    clearProject,
    resetCanvas,
    createProjectConsoleNode,
    createProjectRootNode,
  } = projectLifecycle

  /**
   * 更新节点数据
   *
   * 实现逻辑：
   * 1. 调用 nodeOperations 中的 updateNodeDataInArray 进行数据更新
   * 2. 使用不可变更新模式，返回新的节点数组
   *
   * 副作用：
   * - [Vue Flow] 节点数据变更会触发节点视图重绘
   * - 可能触发连接的重新计算（如果数据影响连接逻辑）
   *
   * @param nodeId - 节点 ID
   * @param newData - 要更新的数据（Partial）
   */
  function updateNodeData(nodeId: string, newData: Partial<CustomNodeData>) {
    nodes.value = updateNodeDataInArray(nodes.value, nodeId, newData)
  }

  // =====================================
  // 行内数据源自动重新校验
  // =====================================
  // 监听 manualData / transformOutput 节点的 rows 数据变化，
  // 自动触发已连接约束节点的重新校验
  const inlineSourceFingerprint = computed(() => {
    let fp = ''
    for (const n of nodes.value) {
      if (n.type === 'manualData' || n.type === 'transformOutput') {
        const d = (n.data || {}) as Record<string, unknown>
        fp += `${n.id}:${JSON.stringify((d.rows as string[][]) || [])}|`
      }
    }
    return fp
  })

  let inlineValidationDebounce: ReturnType<typeof setTimeout> | null = null

  watch(inlineSourceFingerprint, (newVal, oldVal) => {
    if (!oldVal || newVal === oldVal) return

    if (inlineValidationDebounce) clearTimeout(inlineValidationDebounce)

    inlineValidationDebounce = setTimeout(() => {
      for (const node of nodes.value) {
        if (node.type !== 'manualData' && node.type !== 'transformOutput') continue

        const constraintEdges = edges.value.filter((e) => e.source === node.id)
        for (const edge of constraintEdges) {
          const constraintNode = nodes.value.find((n) => n.id === edge.target)
          if (!constraintNode || !isConstraintNodeType(constraintNode.type)) continue

          validateForInlineSource({
            sourceNodeId: node.id,
            constraintNode,
            nodes: nodes.value,
            updateNodeData,
          }).catch((err) => {
            logger.warn('Inline auto-revalidation failed:', err)
          })
        }
      }
    }, 400) // 400ms 防抖，避免输入过程中频繁触发校验
  }, { flush: 'post' })

  const schemaOps = createSchemaOpsModule({
    nodes,
    edges,
    updateNodeData,
    syncOnConnect: connectionStateSync.syncOnConnect,
  })
  const {
    bindRegexToSchemaColumn,
    addConstraintToColumn,
    removeConstraintFromColumn,
    hasColumnConstraint,
    clearColumnValidationErrors,
    clearAllValidationErrors,
  } = schemaOps

  /**
   * 收集删除节点时需要一并级联删除的子节点 ID
   *
   * 当前规则：
   * - 删除 transform 时，同时删除其自动生成的 transformOutput 子节点
   *
   * 兼容策略：
   * - 优先使用 transform.data.outputNodeIds
   * - 同时回退扫描 parentTransformId，避免历史数据或中间状态漏删
   */
  function collectCascadeNodeIds(nodeId: string): string[] {
    const node = nodes.value.find((n) => n.id === nodeId)
    if (!node) return [nodeId]

    // 模板实例：级联删除其展开预览节点
    if (node.type === 'templateInstance') {
      return [nodeId, ...templateExpand.getExpandedIds(nodeId)]
    }

    if (node.type !== 'transform') {
      return [nodeId]
    }

    const transformData = (node.data || {}) as Record<string, unknown>
    const outputNodeIds = Array.isArray(transformData.outputNodeIds)
      ? (transformData.outputNodeIds as string[])
      : []

    const childIdsByParentRef = nodes.value
      .filter((candidate) => {
        if (candidate.type !== 'transformOutput') return false
        const outputData = (candidate.data || {}) as Record<string, unknown>
        return outputData.parentTransformId === nodeId
      })
      .map((candidate) => candidate.id)

    return Array.from(new Set([nodeId, ...outputNodeIds, ...childIdsByParentRef]))
  }

  /**
   * 删除单个节点
   *
   * 删除策略：
   * 1. 保护性检查：禁止删除 projectRoot 节点
   * 2. 节点删除：过滤掉指定 ID 的节点
   * 3. 边清理：同时删除所有与该节点相连的边
   * 4. 选中状态：如果删除的是当前选中节点，清除选中状态
   *
   * 注意事项：
   * - 此函数只做数据层面的删除
   * - UI 层面的删除动画由调用方处理
   *
   * @param nodeId - 要删除的节点 ID
   */
  function deleteNode(nodeId: string) {
    const node = nodes.value.find((n) => n.id === nodeId)
    if (node?.type === 'projectRoot') {
      return
    }

    const deleteIds = collectCascadeNodeIds(nodeId)
    const nodeIdSet = new Set(deleteIds)

    // 先通过 API 逐条删除关联边，触发 onEdgesChange → handleEdgeRemoved 清理链
    const relatedEdges = edges.value.filter(
      (e) => nodeIdSet.has(e.source) || nodeIdSet.has(e.target)
    )
    for (const edge of relatedEdges) {
      removeEdges(edge.id)
    }

    // 再通过 API 删除节点（自动清理 Vue Flow 内部状态）
    removeNodes(deleteIds)

    selectedNodeIds.value = selectedNodeIds.value.filter((id) => !nodeIdSet.has(id))

    if (selectedNodeId.value && nodeIdSet.has(selectedNodeId.value)) {
      selectedNodeId.value = null
    }

    // 删除后重建连接状态，确保 parent/children/outputPortConnected 一致
    nextTick(() => {
      connectionStateSync.reconcileAll()
    })
  }

  /**
   * 移动选中的节点
   *
   * 实现逻辑：
   * 1. 检查是否有选中的节点
   * 2. 直接修改节点 position 属性（Vue 响应式）
   *
   * 注意事项：
   * - 只移动单个节点（selectedNodeId）
   * - 批量移动使用 moveSelectedNodes
   * - 位置变化会触发 Vue Flow 自动重绘
   *
   * @param deltaX - X轴偏移量
   * @param deltaY - Y轴偏移量
   */
  function moveSelectedNode(deltaX: number, deltaY: number) {
    if (!selectedNodeId.value) {
      return
    }

    const node = nodes.value.find((n) => n.id === selectedNodeId.value)
    if (!node) {
      return
    }

    node.position.x += deltaX
    node.position.y += deltaY
  }

  const {
    selectAllNodes,
    addToSelection,
    removeFromSelection,
    clearSelection,
    setSelection,
    setSelectionFromBox,
    setSelectionBox,
    setSelecting,
  } = createSelectionModule({ nodes, selectedNodeId, selectedNodeIds, selectionBox, isSelecting })

  /**
   * 批量删除节点
   *
   * 删除策略：
   * 1. 过滤保护节点：排除 projectRoot 类型节点
   * 2. 批量删除：一次性删除多个节点
   * 3. 边清理：自动删除所有与被删节点相连的边
   *
   * 与 deleteNode 的区别：
   * - deleteNode: 删除单个节点
   * - deleteNodes: 批量删除，优化性能（单次遍历）
   *
   * @param nodeIds - 要删除的节点 ID 列表
   */
  function deleteNodes(nodeIds: string[]) {
    const filteredIds = nodeIds.filter((id) => {
      const node = nodes.value.find((n) => n.id === id)
      return node?.type !== 'projectRoot'
    })

    if (filteredIds.length === 0) {
      return
    }

    const deleteIds = Array.from(new Set(filteredIds.flatMap((id) => collectCascadeNodeIds(id))))
    const nodeIdSet = new Set(deleteIds)

    // 先通过 API 逐条删除关联边，触发 onEdgesChange → handleEdgeRemoved 清理链
    const relatedEdges = edges.value.filter(
      (e) => nodeIdSet.has(e.source) || nodeIdSet.has(e.target)
    )
    for (const edge of relatedEdges) {
      removeEdges(edge.id)
    }

    // 再通过 API 删除节点
    removeNodes(deleteIds)

    selectedNodeIds.value = selectedNodeIds.value.filter((id) => !nodeIdSet.has(id))

    if (selectedNodeId.value && nodeIdSet.has(selectedNodeId.value)) {
      selectedNodeId.value = null
    }

    nextTick(() => {
      connectionStateSync.reconcileAll()
    })
  }

  /**
   * 批量移动选中的节点
   *
   * @param deltaX X轴偏移量
   * @param deltaY Y轴偏移量
   */
  function moveSelectedNodes(deltaX: number, deltaY: number) {
    if (selectedNodeIds.value.length === 0) {
      return
    }

    for (const node of nodes.value) {
      if (selectedNodeIds.value.includes(node.id)) {
        node.position.x += deltaX
        node.position.y += deltaY
      }
    }
  }

  const { undoStack, redoStack, saveState, undo, redo } = createHistoryModule({ nodes, edges, reconcileAll: connectionStateSync.reconcileAll })

  const { cutSelectedNodes, copySelectedNodes, pasteNodes, duplicateSelectedNode } =
    createClipboardModule({
      nodes,
      edges,
      selectedNodeId,
      selectedNodeIds,
      copiedNodes,
      deleteNode,
      deleteNodes,
      saveState,
      pasteOffset,
      reconcileAll: connectionStateSync.reconcileAll,
    })

  /**
   * 设置选中节点
   *
   * 业务逻辑：
   * 1. 单选模式：设置单个节点为选中状态
   * 2. 取消选中：传入 null 清除选中状态
   *
   * 副作用：
   * - [Vue Flow] 选中状态变化会更新节点的高亮样式
   * - 会触发属性检查器面板的更新（显示选中节点的数据）
   *
   * @param nodeId - 节点 ID，传入 null 取消选中
   */
  function setSelectedNode(nodeId: string | null) {
    selectedNodeId.value = nodeId
  }

  // --- 连接管理 ---

  const { createConnection, deleteConnection, handleEdgeRemoved } = createConnectionOpsModule({
    nodes,
    edges,
    updateNodeData,
    clearAllValidationErrors,
    syncOnDisconnect: connectionStateSync.syncOnDisconnect,
  })

  /**
   * 清空画布
   *
   * 业务场景：
   * 当用户创建新项目或执行"新建"操作时调用。
   *
   * 清空策略：
   * 1. 节点数组：设置为空数组
   * 2. 边数组：设置为空数组
   * 3. 选中状态：设置为 null
   *
   * 注意事项：
   * - 不删除 projectRoot 节点（如果有的话，通过其他方式处理）
   * - 这是不可逆操作，建议先调用 hasUnsavedChanges 检查
   *
   * 副作用：
   * - [Vue Flow] 画布视图会变为空白
   * - 属性检查器面板会清空
   */
  function clearCanvas() {
    templateExpand.resetAll()
    nodes.value = []
    edges.value = []
    selectedNodeId.value = null
  }

  const { buildProjectYAML, exportProjectAsFile, exportSchemaAsYAML, importSchemaFromYAML } =
    createYamlIOModule({
      nodes,
      assets,
      projectName,
      selectedNodeId,
    })

  function hasUnsavedChanges(): boolean {
    return nodes.value.some((node) => {
      // 跳过模板展开预览节点（它们不会被持久化）
      const data = node.data as unknown as Record<string, unknown>
      if (data._expandedFromInstanceId) return false

      // 普通 schema 和 JSON schema 都需要检查（F12）
      if (node.type === 'schema' || node.type === 'jsonSchema') {
        const schemaData = node.data as SchemaNodeData
        return schemaData.saveState === 'draft'
      }
      if (isConstraintNodeType(node.type)) {
        return data?.saveState === 'draft'
      }
      if (node.type === 'regex') {
        return data?.saveState === 'draft'
      }
      if (node.type === 'transform') {
        return data?.saveState === 'draft'
      }
      if (node.type === 'templateInstance') {
        return data?.saveState === 'draft'
      }
      return false
    })
  }

  /**
   * 获取项目保存状态摘要
   */
  function getSaveStatusSummary() {
    const totalSchemas = nodes.value.filter((n) => n.type === 'schema').length
    const savedSchemas = nodes.value.filter((n) => {
      if (n.type === 'schema') {
        const schemaData = n.data as SchemaNodeData
        return schemaData.saveState === 'saved'
      }
      return false
    }).length

    const totalTransforms = nodes.value.filter((n) => n.type === 'transform').length
    const savedTransforms = nodes.value.filter((n) => {
      if (n.type === 'transform') {
        return (n.data as unknown as Record<string, unknown>)?.saveState === 'saved'
      }
      return false
    }).length

    return {
      total: totalSchemas + totalTransforms,
      saved: savedSchemas + savedTransforms,
      unsaved: totalSchemas - savedSchemas + totalTransforms - savedTransforms,
      hasChanges: hasUnsavedChanges(),
    }
  }

  const { openRegexDesignModal, closeRegexDesignModal, saveRegexDesign, setRegexEditSampleData } =
    createRegexDesignModule({
      nodes,
      designModalVisible,
      activeRegexNodeId,
      regexEditSampleData,
      updateNodeData,
    })

  const { saveCanvasAsAsset, loadAssetToCanvas } = createAssetsModule({
    nodes,
    assets,
    clearCanvas,
    createSchemaNode,
  })

  const { switchScope, getSubGraphStats } = createScopeModule({ nodes, edges })

  // ============================================================================
  // V2 Schema ID 映射管理
  // ============================================================================

  function registerV2SchemaMapping(canvasNodeId: string, v2SchemaId: string) {
    v2SchemaIdMap.value.set(canvasNodeId, v2SchemaId)
  }

  function getV2SchemaId(canvasNodeId: string): string | undefined {
    if (canvasNodeId.startsWith('sc_')) return canvasNodeId
    return v2SchemaIdMap.value.get(canvasNodeId)
  }

  return {
    // 状态
    nodes,
    edges,
    assets,
    selectedNode,
    selectedNodeId,
    v2SchemaIdMap,
    selectedNodes,
    hasMultipleSelection,
    selectedNodeIds,
    selectionBox,
    isSelecting,
    isProjectLoaded,
    projectName,
    projectConfigStats,
    projectConfigStatsLoaded,
    lastFullValidationSummary,
    lastFullValidationStatistics,
    // 正则表达式设计弹窗状态
    designModalVisible,
    activeRegexNodeId,
    activeRegexNode,
    regexEditSampleData,

    // 项目管理
    createProject,
    clearProject,
    resetCanvas,
    setLastFullValidationSummary,
    setLastFullValidationStatistics,

    // 节点操作
    createProjectConsoleNode,
    createProjectRootNode,
    createPatternToolboxNode,
    createConstraintDashboardNode,
    createSchemaNode,
    addColumnToSchema,
    createConstraintNode,
    createRegexNode,
    createTransformNode,
    createTransformOutputNode,
    createManualDataNode,
    createJsonSchemaNode,
    createJsonSourcePreviewNode,
    createTemplateInstanceNode,
    expandOnCanvas: templateExpand.expandOnCanvas,
    clearExpansion: templateExpand.clearExpansion,
    collapseExpansion: templateExpand.collapseExpansion,
    reExpand: templateExpand.reExpand,
    getExpandedIds: templateExpand.getExpandedIds,
    createEmptyTableNode,
    createEmptyPatternNode,
    createLogicNode,
    updateNodeData,
    bindRegexToSchemaColumn,
    deleteNode,
    setSelectedNode,
    copySelectedNodes,
    pasteNodes,
    duplicateSelectedNode,
    moveSelectedNode,
    moveSelectedNodes,
    selectAllNodes,
    cutSelectedNodes,

    // 多选操作
    addToSelection,
    removeFromSelection,
    clearSelection,
    setSelection,
    setSelectionFromBox,
    deleteNodes,

    // 框选操作
    setSelectionBox,
    setSelecting,

    // 历史记录管理
    undoStack,
    redoStack,
    saveState,
    undo,
    redo,
    addConstraintToColumn,
    removeConstraintFromColumn,
    hasColumnConstraint,

    // 约束校验管理
    clearColumnValidationErrors,
    clearAllValidationErrors,

    // 连接管理
    createConnection,
    deleteConnection,
    handleEdgeRemoved,

    // 连接状态同步
    syncOnConnect: connectionStateSync.syncOnConnect,
    syncOnDisconnect: connectionStateSync.syncOnDisconnect,
    reconcileAll: connectionStateSync.reconcileAll,

    // 画布管理
    clearCanvas,

    // 数据导入导出和保存
    exportSchemaAsYAML,
    importSchemaFromYAML,
    buildProjectYAML,
    saveProject: v2Persistence.saveProject,
    exportProjectAsFile,
    saveSchemaNode: v2Persistence.saveSchemaNode,
    saveConstraintNode: v2Persistence.saveConstraintNode,
    saveRegexNode: v2Persistence.saveRegexNode,
    saveTransformNode: v2Persistence.saveTransformNode,
    saveTemplateInstanceNode: v2Persistence.saveTemplateInstanceNode,
    loadProjectFromV2: v2Persistence.loadProjectFromV2,
    importV2ResourceToCanvas,
    refreshProjectConfigStats: v2Persistence.refreshProjectConfigStats,
    hasUnsavedChanges,
    getSaveStatusSummary,

    // 资源管理
    saveCanvasAsAsset,
    loadAssetToCanvas,

    // 作用域管理
    switchScope,

    // 统计信息
    getSubGraphStats,

    // V2 Schema ID 映射管理
    registerV2SchemaMapping,
    getV2SchemaId,

    // 正则表达式设计弹窗管理
    openRegexDesignModal,
    closeRegexDesignModal,
    saveRegexDesign,
    setRegexEditSampleData,

    // 模板定义管理 API
    listV2Templates,
    getV2Template,
    createV2Template,
    updateV2Template,
    deleteV2Template,
    expandV2Template,
  }
}
