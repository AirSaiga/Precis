/**
 * @file useConnections.ts
 * @description 画布连接（边）管理组合式函数
 *
 * 负责处理 Vue Flow 画布中所有节点连接事件的 orchestration，
 * 根据源节点类型和目标节点类型分派到具体的连接处理器。
 *
 * 功能概述：
 * - onConnect: 全局连接事件入口，按节点类型分派
 * - Schema → Column: 创建列定义边
 * - Schema → Regex: 创建正则校验边
 * - Schema → Constraint: 按约束类型分派到具体处理器（NotNull/Unique/FK/Conditional/Scripted/Range/Charset/DateLogic/AllowedValues）
 * - Schema → JsonSchema: JSON Schema 连接处理
 * - SourcePreview → Schema: 数据源绑定边
 * - 连接验证：阻止非法连接（如 Constraint → Constraint）
 * - 连接提示：非法连接时显示 Toast 提示
 *
 * 架构设计：
 * - 组合式函数模式，聚合各类型连接子处理器
 * - 每个约束类型有独立的 useXxxConnection 子处理器
 * - 使用 Vue Flow 的 useVueFlow 获取 addEdges / findEdge 等 API
 * - 连接前通过 validationRegistry 判断节点类型和合法性
 */

import { logger } from '@/core/utils/logger'
import { ref } from 'vue'
import type { Connection, OnConnectStartParams } from '@vue-flow/core'
import { useVueFlow } from '@vue-flow/core'
import { useGraphStore } from '@/stores/graphStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSchemaConnectionHandler } from './schema/useSchemaConnectionHandler'
import { useRegexConnection } from '@/features/regex/composables'
import { useForeignKeyConnection } from './constraints/useForeignKeyConnection'
import { useConditionalConnection } from './constraints/useConditionalConnection'
import { useConstraintConnection } from './constraints/useConstraintConnection'
import { useJsonSchemaConnectionHandler } from './json/useJsonSchemaConnectionHandler'
import { getV2FullConfig } from '@/api/projectV2Api'
import type { PatternRegistryTypeV2 } from '@/types/projectV2'
import {
  getConstraintKindByNodeType,
  isConstraintNodeType,
  requiresInputHandle,
} from '@/services/constraints/validationRegistry'
import { validateForInlineSource } from '@/services/constraints/validationRegistryCore'
import { createConnectionTransaction } from '@/utils/nodes/connectionTransaction'

export function useConnections() {
  // 获取全局图存储，用于访问节点和连接数据
  const store = useGraphStore()

  // VueFlow 实例，用于操作边
  const { removeEdges } = useVueFlow()

  // 存储连接开始时的参数信息，用于后续连接完成时验证
  // 包含源节点 ID、源 handle ID 等信息
  const dragStartData = ref<OnConnectStartParams | null>(null)

  // 实例化各类连接处理器，用于处理不同节点类型之间的连接逻辑
  // 每个处理器负责特定节点类型的连接验证和数据更新
  const schemaConnection = useSchemaConnectionHandler()
  const regexConnection = useRegexConnection()
  const foreignKeyConnection = useForeignKeyConnection()
  const conditionalConnection = useConditionalConnection()
  const constraintConnection = useConstraintConnection()
  const jsonSchemaHandler = useJsonSchemaConnectionHandler()
  /**
   * 连接处理器包装函数
   * 将各个连接处理器的执行结果统一包装为 Promise，并在出错时抛出 ConnectionHandlerError
   * 这样可以在连接失败时提供更有意义的错误信息，便于调试
   * @param handlerName - 处理器名称，用于错误提示
   * @param fn - 原始的连接处理器函数
   * @returns 包装后的处理器函数，执行失败时会抛出 ConnectionHandlerError
   */
  const toConnectionResult = <Args extends unknown[]>(
    handlerName: string,
    fn: (...args: Args) => Promise<void>
  ): ((...args: Args) => Promise<void>) => {
    return (...args: Args) => {
      try {
        const result = fn(...args)
        if (result instanceof Promise) {
          return result.catch((e: unknown) => {
            throw new ConnectionHandlerError(handlerName, e)
          })
        }
        return Promise.resolve(result)
      } catch (e) {
        return Promise.reject(new ConnectionHandlerError(handlerName, e))
      }
    }
  }

  /**
   * 连接处理器错误类
   * 用于包装连接处理器执行过程中抛出的异常，携带处理器名称和原始错误信息
   */
  class ConnectionHandlerError extends Error {
    constructor(
      /** 发生错误的处理器名称 */
      public readonly handlerName: string,
      /** 原始错误对象 */
      public readonly cause: unknown
    ) {
      super(`连接处理器 [${handlerName}] 执行失败`)
      this.name = 'ConnectionHandlerError'
    }
  }

  /**
   * 约束类型到连接处理器的映射表
   * 根据约束类型（如 notNull、unique 等）查找对应的连接处理器
   * 每个处理器负责处理 Schema 节点到特定约束节点的连接逻辑
   */
  const constraintConnectionHandlers: Record<
    string,
    (
      sourceId: string,
      targetId: string,
      sourceHandleId: string,
      targetHandleId?: string | null,
      edgeId?: string
    ) => Promise<void>
  > = {
    notNull: toConnectionResult('notNull', (s, t, sh, th) =>
      constraintConnection.handleSchemaToConstraint(s, t, sh, th, {
        kind: 'notNull',
        nodeType: 'notNullConstraint',
        dispatchValidation: true,
        addConstraintToColumn: true,
        resetOnConnect: false,
      })
    ),
    unique: toConnectionResult('unique', (s, t, sh, th) =>
      constraintConnection.handleSchemaToConstraint(s, t, sh, th, {
        kind: 'unique',
        nodeType: 'uniqueConstraint',
        dispatchValidation: true,
        addConstraintToColumn: true,
        resetOnConnect: false,
      })
    ),
    allowedValues: toConnectionResult('allowedValues', (s, t, sh, th) =>
      constraintConnection.handleSchemaToConstraint(s, t, sh, th, {
        kind: 'allowedValues',
        nodeType: 'allowedValuesConstraint',
        dispatchValidation: true,
        addConstraintToColumn: false,
        resetOnConnect: true,
      })
    ),
    range: toConnectionResult('range', (s, t, sh, th) =>
      constraintConnection.handleSchemaToConstraint(s, t, sh, th, {
        kind: 'range',
        nodeType: 'rangeConstraint',
        dispatchValidation: true,
        addConstraintToColumn: false,
        resetOnConnect: true,
      })
    ),
    scripted: toConnectionResult('scripted', (s, t, sh, th) =>
      constraintConnection.handleSchemaToConstraint(s, t, sh, th, {
        kind: 'scripted',
        nodeType: 'scriptedConstraint',
        dispatchValidation: true,
        addConstraintToColumn: false,
        resetOnConnect: true,
      })
    ),
    charset: toConnectionResult('charset', (s, t, sh, th) =>
      constraintConnection.handleSchemaToConstraint(s, t, sh, th, {
        kind: 'charset',
        nodeType: 'charsetConstraint',
        dispatchValidation: true,
        addConstraintToColumn: false,
        resetOnConnect: true,
      })
    ),
    dateLogic: toConnectionResult('dateLogic', (s, t, sh, th) =>
      constraintConnection.handleSchemaToConstraint(s, t, sh, th, {
        kind: 'dateLogic',
        nodeType: 'dateLogicConstraint',
        dispatchValidation: true,
        addConstraintToColumn: false,
        resetOnConnect: true,
      })
    ),
    conditional: toConnectionResult(
      'conditional',
      conditionalConnection.handleSchemaToConditionalConnection
    ),
    foreignKey: toConnectionResult(
      'foreignKey',
      foreignKeyConnection.handleSchemaToForeignKeyConnection
    ),
  }

  /**
   * Toast 消息提示函数
   * 通过控制台输出消息等级，用于调试和用户反馈
   * @param message - 要显示的消息内容
   * @param type - 消息类型，success=成功，error=错误，info=信息
   */
  const showToastMessage = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    logger.debug(`[${type.toUpperCase()}] ${message}`)
  }

  /**
   * 连接开始事件处理
   * 当用户开始拖拽连接线时触发，记录连接起始点信息
   * @param params - 连接开始参数，包含 source、sourceHandle 等信息
   */
  const onConnectStart = (params: OnConnectStartParams) => {
    // 将连接开始参数存储到 ref 中，供后续连接完成时使用
    dragStartData.value = params
  }

  /**
   * 连接完成事件处理 - 分发到对应的连接处理器
   * 这是连接管理的核心方法，根据源节点和目标节点的类型，
   * 将连接请求分发到对应的处理器，并设置连接线的样式
   * @param connection - 连接对象，包含 source、target、sourceHandle、targetHandle
   */
  const handleConnectionCompleted = async (connection: Connection) => {
    // 从连接对象中解构出源节点、目标节点和 handle 信息
    const { source, target, sourceHandle, targetHandle } = connection

    // 在全局 store 中查找源节点和目标节点
    // 使用节点 ID 在 nodes 数组中查找对应的节点对象
    const sourceNode = store.nodes.find((n) => n.id === source)
    const targetNode = store.nodes.find((n) => n.id === target)

    // 如果任一节点不存在，直接返回（防御性检查）
    if (!sourceNode || !targetNode) {
      return
    }

    if (sourceNode.type === 'patternToolbox' && targetNode.type === 'schema') {
      const patternId =
        sourceHandle && sourceHandle.startsWith('pattern-')
          ? sourceHandle.replace('pattern-', '')
          : ''
      const columnId =
        targetHandle && targetHandle.startsWith('pattern-drop-')
          ? targetHandle.replace('pattern-drop-', '')
          : ''
      if (!patternId || !columnId) return

      const basePos = {
        x: (targetNode.position?.x || 0) + 420,
        y: targetNode.position?.y || 0,
      }
      const regexNodeId = await store.importV2ResourceToCanvas('pattern', patternId, basePos, {
        includeDeps: false,
        moveIfExists: true,
      })
      if (!regexNodeId) return

      store.bindRegexToSchemaColumn(targetNode.id, columnId, regexNodeId)
      return
    }

    if (
      (sourceNode.type === 'pattern' || sourceNode.type === 'schema') &&
      targetNode.type === 'regex' &&
      (!targetHandle || targetHandle === 'regex-input')
    ) {
      // Pattern → Regex: 使用"吸附填充"效果，不需要创建连接线
      if (sourceNode.type === 'pattern') {
        const patternNodeData = sourceNode.data as Record<string, unknown>
        const regexNodeData = targetNode.data as Record<string, unknown>

        const patternId = patternNodeData?.patternId as string | undefined
        const registry = patternNodeData?.registry as PatternRegistryTypeV2 | undefined

        // 从完整路径中提取纯 ID，例如 "patterns/email" -> "email"
        const purePatternId = patternId?.includes('/') ? patternId.split('/').pop() : patternId

        if (!patternId || !registry) {
          return
        }

        const projectStore = useProjectStore()
        const configPath = projectStore.currentPaths?.configPath

        if (!configPath) {
          return
        }

        const fullConfig = await getV2FullConfig(configPath)
        const registryKey = `${registry}/${purePatternId}`

        const patternData = fullConfig.regex_registries?.[registryKey] as
          | {
              definition?: {
                pattern?: string
                regex?: string
                flags?: string
                case_sensitive?: boolean
              }
            }
          | undefined

        if (!patternData) {
          return
        }

        const definition = patternData.definition
        const patternContent = definition?.pattern || definition?.regex || ''

        const updatedRegexData = {
          ...regexNodeData,
          uses_pattern: {
            registry,
            pattern_name: purePatternId,
          },
          pattern: patternContent,
          flags: definition?.flags || 'g',
          caseSensitive: definition?.case_sensitive ?? true,
          saveState: 'draft' as const,
          validationStatus: 'idle' as const,
        }

        store.updateNodeData(targetNode.id, updatedRegexData)

        // 创建一条"流动吸附"的连接线
        const edgeStyle = {
          type: 'smoothstep' as const,
          animated: true,
          style: { stroke: 'var(--node-accent)', strokeWidth: 2 },
          data: { isAbsorbing: true },
        }
        const edgeId = store.createConnection(
          sourceNode.id,
          targetNode.id,
          'pattern-output',
          'regex-input',
          edgeStyle
        )

        // 600ms 后删除连接线，模拟"被吸收"的效果
        setTimeout(() => {
          removeEdges(edgeId)
          // 删除 Pattern 节点，模拟被"消耗"到 Regex 中
          store.deleteNode(sourceNode.id)
        }, 600)

        logger.debug(
          `[Pattern→Regex] 已将 pattern '${patternId}' (${registry}) 关联到 regex 节点 '${targetNode.id}'`
        )
        return
      }
    }

    const createEdgeStyle = () => ({
      type: 'smoothstep',
      animated: true,
      style: { strokeWidth: 1.5 },
    })

    const shortcutCreatedNodeId =
      foreignKeyConnection.handleSchemaToSchemaForeignKeyShortcutConnection(
        sourceNode.id,
        targetNode.id,
        sourceHandle,
        targetHandle || undefined,
        {
          ...createEdgeStyle(),
          style: { stroke: 'var(--edge-default)', strokeWidth: 1.5 },
        }
      )

    if (shortcutCreatedNodeId) {
      return
    }

    if (sourceNode.type === 'sourcePreview' && targetNode.type === 'foreignKeyConstraint') {
      logger.warn('⚠️ 当前外键节点不支持从 SourcePreview 直接建立参照连接')
      return
    }

    if (
      (sourceNode.type === 'schema' ||
        sourceNode.type === 'jsonSchema' ||
        sourceNode.type === 'manualData' ||
        sourceNode.type === 'transformOutput') &&
      isConstraintNodeType(targetNode.type)
    ) {
      if (!isValidConstraintTargetHandle(targetNode.id, targetNode.type, targetHandle)) {
        showToastMessage('约束连接目标端口不匹配，请连接到正确的输入端口', 'error')
        return
      }
    }

    // 根据源节点和目标节点的类型组合，设置不同的边样式和标签
    // 使用翡翠绿色 (#059669) 表示 SourcePreview → Schema 数据源连接
    const edgeStyle: Record<string, unknown> = createEdgeStyle()
    if (sourceNode.type === 'sourcePreview' && targetNode.type === 'schema') {
      edgeStyle.style = { stroke: 'var(--edge-data-source)', strokeWidth: 1.5 } // was #059669
      edgeStyle.label = 'Data Source'
    } else if (sourceNode.type === 'manualData' && targetNode.type === 'schema') {
      edgeStyle.style = { stroke: 'var(--edge-data-source)', strokeWidth: 1.5 }
      edgeStyle.label = 'Manual Data'
    } else if (sourceNode.type === 'schema' && targetNode.type === 'manualData') {
      edgeStyle.style = { stroke: 'var(--edge-data-flow)', strokeWidth: 2 }
      edgeStyle.label = 'Column Data'
    } else if (sourceNode.type === 'manualData' && isConstraintNodeType(targetNode.type)) {
      edgeStyle.style = { stroke: 'var(--edge-default)', strokeWidth: 1.5 }
    } else if (
      sourceNode.type === 'foreignKeyConstraint' &&
      targetNode.type === 'schema' &&
      targetHandle === 'target-left'
    ) {
      // [展示边样式（FK→Schema）]
      // 这里把 FK→Schema 的连线统一视为“展示边”，用于帮助用户理解参照关系，但不参与数据/校验语义。
      // 因此我们显式设置：
      // - animated=false：避免与真实数据流边混淆
      // - class='fk-display-edge'：交由画布 CSS 控制“若隐若现”的动态效果
      // - strokeDasharray：虚线强化“提示/引用”的语义
      //
      // 注意：FK 节点内部也支持通过开关自动生成展示边；手工连线属于同一种展示语义。
      edgeStyle.animated = false
      edgeStyle.class = 'fk-display-edge'
      edgeStyle.style = {
        stroke: 'var(--edge-fk-display)',
        strokeWidth: 1.4,
        strokeDasharray: '2 8',
      } // was rgba(139,92,246,0.65)
      edgeStyle.data = { kind: 'fkTargetDisplay', fkNodeId: sourceNode.id }
    } else if (
      (sourceNode.type === 'schema' ||
        sourceNode.type === 'jsonSchema' ||
        sourceNode.type === 'manualData') &&
      isConstraintNodeType(targetNode.type)
    ) {
      edgeStyle.style = { stroke: 'var(--edge-default)', strokeWidth: 1.5 }
    } else if (
      (sourceNode.type === 'schema' || sourceNode.type === 'jsonSchema') &&
      isConstraintNodeType(targetNode.type)
    ) {
      if (targetNode.type === 'conditionalConstraint') {
        const ifHandle = `target-if-${targetNode.id}`
        const thenHandle = `target-then-${targetNode.id}`
        const legacyThenHandle = `target-input-${targetNode.id}`
        if (targetHandle === thenHandle || targetHandle === legacyThenHandle) {
          edgeStyle.style = {
            stroke: 'var(--edge-conditional-then)',
            strokeWidth: 2.2,
            strokeDasharray: '4 6',
          } // was #0ea5e9
          edgeStyle.label = 'THEN'
        } else if (targetHandle === ifHandle) {
          edgeStyle.style = { stroke: 'var(--edge-conditional-if)', strokeWidth: 2 } // was #6f42c1
          edgeStyle.label = 'IF'
        } else {
          edgeStyle.style = { stroke: 'var(--edge-default)', strokeWidth: 1.5 } // was #f59e0b
        }
      } else {
        edgeStyle.style = { stroke: 'var(--edge-default)', strokeWidth: 1.5 } // was #f59e0b
      }
    } else if (sourceNode.type === 'schema' && targetNode.type === 'regex') {
      edgeStyle.style = { stroke: 'var(--edge-schema-to-regex)', strokeWidth: 2 } // was #8b5cf6
    } else if (sourceNode.type === 'manualData' && targetNode.type === 'regex') {
      edgeStyle.style = { stroke: 'var(--edge-schema-to-regex)', strokeWidth: 2 }
    } else if (sourceNode.type === 'transformOutput' && targetNode.type === 'regex') {
      edgeStyle.style = { stroke: 'var(--edge-schema-to-regex)', strokeWidth: 2 }
    } else if (sourceNode.type === 'transformOutput' && isConstraintNodeType(targetNode.type)) {
      edgeStyle.style = { stroke: 'var(--edge-default)', strokeWidth: 1.5 }
    } else if (targetNode.type === 'transform' && targetHandle === 'transform-input') {
      edgeStyle.style = { stroke: 'var(--edge-data-flow)', strokeWidth: 2 }
    }

    edgeStyle.data = { ...(edgeStyle.data as Record<string, unknown>), status: 'pending' }
    const edgeId = store.createConnection(
      source,
      target,
      sourceHandle,
      targetHandle || undefined,
      edgeStyle
    )

    const tx = createConnectionTransaction({
      nodes: store.nodes,
      updateNodeData: store.updateNodeData,
    })

    try {
      if (sourceNode.type === 'sourcePreview' && targetNode.type === 'schema') {
        const sourceData = sourceNode.data as Record<string, unknown>
        const currentChildren = (sourceData.children as string[]) || []
        if (!currentChildren.includes(target)) {
          tx.patchNodeData(source, { children: [...currentChildren, target] })
        }
      }

      if (sourceNode.type === 'manualData' && targetNode.type === 'schema') {
        const manualData = sourceNode.data as Record<string, unknown>
        const schemaNode = store.nodes.find((n) => n.id === target)
        if (schemaNode) {
          const columnName = (manualData.columnName as string) || 'Column1'
          const existingCols =
            ((schemaNode.data as Record<string, unknown>).columns as Array<
              Record<string, unknown>
            >) || []
          if (existingCols.length === 0) {
            tx.patchNodeData(target, {
              ...schemaNode.data,
              columns: [
                {
                  id: 'col-0',
                  columnName,
                  dataType: 'string',
                  validationErrors: [],
                  constraints: {},
                },
              ] as any,
              tableName: (manualData.configName as string) || 'ManualData',
              sourceNodeId: source,
            })
          }
        }
      }

      // Schema 列 → ManualData：提取该列数据到手动数据节点
      if (sourceNode.type === 'schema' && targetNode.type === 'manualData') {
        const schemaData = sourceNode.data as Record<string, unknown>
        const columns = (schemaData.columns as Array<{ id: string; columnName: string }>) || []

        // 从 sourceHandle 解析列 ID，例如 "source-right-col-0" → "col-0"
        let columnId = ''
        if (sourceHandle && sourceHandle.startsWith('source-right-')) {
          columnId = sourceHandle.replace('source-right-', '')
        }

        const column = columns.find((c) => c.id === columnId)
        const columnName = column?.columnName || 'Column1'

        // 尝试从关联的 SourcePreview 提取该列数据
        let extractedRows: string[][] = []
        const sourceNodeId = schemaData.sourceNodeId as string | undefined
        if (sourceNodeId) {
          const previewNode = store.nodes.find((n) => n.id === sourceNodeId)
          if (previewNode && previewNode.type === 'sourcePreview') {
            const previewData = previewNode.data as Record<string, unknown>
            const dataMatrix = (previewData.data as string[][]) || []
            const headerRow = (previewData.headerRow as number) ?? 0

            if (dataMatrix.length > 0 && headerRow >= 0 && headerRow < dataMatrix.length) {
              const headers = dataMatrix[headerRow]
              const colIndex = headers.indexOf(columnName)
              if (colIndex >= 0) {
                // 提取数据行（跳过表头行）
                for (let i = 0; i < dataMatrix.length; i++) {
                  if (i === headerRow) continue
                  const row = dataMatrix[i]
                  extractedRows.push([row[colIndex] ?? ''])
                }
              }
            }
          }
        }

        // 如果没有提取到数据，使用默认行
        if (extractedRows.length === 0) {
          extractedRows = [['value1'], ['value2'], ['value3']]
        }

        tx.patchNodeData(target, {
          columnName,
          rows: extractedRows,
          configName: columnName,
          saveState: 'draft',
        })
      }

      if (sourceNode.type === 'jsonSourcePreview' && targetNode.type === 'jsonSchema') {
        const sourceData = sourceNode.data as Record<string, unknown>
        const currentChildren = (sourceData.children as string[]) || []
        if (!currentChildren.includes(target)) {
          tx.patchNodeData(source, { children: [...currentChildren, target] })
        }
      }

      if (sourceNode.type === 'schema' && targetNode.type === 'regex') {
        const sourceData = sourceNode.data as Record<string, unknown>
        const schemaChildren = (sourceData.children as string[]) || []
        if (!schemaChildren.includes(target)) {
          tx.patchNodeData(source, { children: [...schemaChildren, target] })
        }
        tx.patchNodeData(target, { parent: source })
      }

      // ManualData → Regex：手动数据作为正则校验的数据源
      if (sourceNode.type === 'manualData' && targetNode.type === 'regex') {
        const manualData = sourceNode.data as Record<string, unknown>
        const columnName = (manualData.columnName as string) || 'Column1'
        const rows = (manualData.rows as string[][]) || []

        // 更新 regex 节点的数据源信息
        tx.patchNodeData(target, {
          sourceNodeId: source,
          sourceColumnName: columnName,
          configName: `Regex on ${columnName}`,
          saveState: 'draft',
        })

        logger.debug(
          `[ManualData→Regex] 已将 manualData '${sourceNode.id}' 连接到 regex 节点 '${targetNode.id}'`
        )
      }

      if (sourceNode.type === 'jsonSchema' && targetNode.type === 'regex') {
        const sourceData = sourceNode.data as Record<string, unknown>
        const schemaChildren = (sourceData.children as string[]) || []
        if (!schemaChildren.includes(target)) {
          tx.patchNodeData(source, { children: [...schemaChildren, target] })
        }
        tx.patchNodeData(target, { parent: source })
      }

      if (sourceNode.type === 'schema' && isConstraintNodeType(targetNode.type)) {
        const sourceData = sourceNode.data as Record<string, unknown>
        const schemaChildren = (sourceData.children as string[]) || []
        if (!schemaChildren.includes(target)) {
          tx.patchNodeData(source, { children: [...schemaChildren, target] })
        }
        tx.patchNodeData(target, { parent: source })
      }

      if (sourceNode.type === 'jsonSchema' && isConstraintNodeType(targetNode.type)) {
        const sourceData = sourceNode.data as Record<string, unknown>
        const schemaChildren = (sourceData.children as string[]) || []
        if (!schemaChildren.includes(target)) {
          tx.patchNodeData(source, { children: [...schemaChildren, target] })
        }
        tx.patchNodeData(target, { parent: source })
      }

      if (sourceNode.type === 'sourcePreview' && targetNode.type === 'schema') {
        await schemaConnection.handleSourceToSchemaConnection(sourceNode.id, targetNode.id)
      }

      if (sourceNode.type === 'jsonSourcePreview' && targetNode.type === 'jsonSchema') {
        await jsonSchemaHandler.handleSourceConnection({ source, target })
      }

      if (sourceNode.type === 'sourcePreview' && targetNode.type === 'foreignKeyConstraint') {
        logger.warn('⚠️ 当前外键节点不支持从 SourcePreview 直接建立参照连接')
      }

      if (
        sourceNode.type === 'foreignKeyConstraint' &&
        targetNode.type === 'schema' &&
        targetHandle === 'target-left'
      ) {
        foreignKeyConnection.handleForeignKeyToSchemaConnection(
          sourceNode.id,
          targetNode.id,
          targetHandle || undefined
        )
      }

      if (
        (sourceNode.type === 'schema' ||
          sourceNode.type === 'jsonSchema' ||
          sourceNode.type === 'transformOutput' ||
          sourceNode.type === 'manualData') &&
        isConstraintNodeType(targetNode.type)
      ) {
        if (sourceHandle) {
          const constraintType = getConstraintKindByNodeType(targetNode.type)
          const handler = constraintConnectionHandlers[constraintType]
          if (handler) {
            await handler(sourceNode.id, targetNode.id, sourceHandle, targetHandle, edgeId)
          } else if (sourceNode.type === 'transformOutput' || sourceNode.type === 'manualData') {
            // 纯数据源 → 无专用处理器的约束类型（如 foreignKey / composite）：
            // 设置基本引用数据，并触发行内校验
            const srcData = sourceNode.data as Record<string, unknown>
            const colName = (srcData.columnName as string) || 'Column1'
            tx.patchNodeData(targetNode.id, {
              ...((targetNode.data || {}) as Record<string, unknown>),
              table: (srcData.configName as string) || colName,
              column: colName,
              sourceRef: { nodeId: sourceNode.id, columnId: '0' },
              saveState: 'draft',
            })
            // 触发行内校验（异步，不阻塞连接创建）
            validateForInlineSource({
              sourceNodeId: sourceNode.id,
              constraintNode: targetNode,
              nodes: store.nodes,
              updateNodeData: store.updateNodeData,
            }).catch((err) => {
              logger.warn('⚠️ 纯数据源行内校验失败:', err)
            })
            logger.debug('🔗 纯数据源 → 约束节点（回退处理+校验）:', {
              sourceType: sourceNode.type,
              colName,
              constraintType: targetNode.type,
            })
          } else {
            logger.debug('ℹ️ 暂不支持该约束类型的连接处理:', constraintType)
          }
        }
      }

      // templateInstance 输入连接：设置 inputFromNode
      if (targetNode.type === 'templateInstance') {
        tx.patchNodeData(targetNode.id, {
          ...((targetNode.data || {}) as Record<string, unknown>),
          inputFromNode: sourceNode.id,
          saveState: 'draft',
        })
        logger.debug('🔗 数据源 → 模板实例:', {
          sourceType: sourceNode.type,
          sourceId: sourceNode.id,
          instanceId: targetNode.id,
        })
      }

      if (sourceNode.type === 'schema' && targetNode.type === 'regex') {
        if (sourceHandle) {
          await regexConnection.handleSchemaToRegexConnection(
            sourceNode.id,
            targetNode.id,
            sourceHandle
          )
        }
      }

      if (sourceNode.type === 'transformOutput' && targetNode.type === 'regex') {
        const outputData = sourceNode.data as Record<string, unknown>
        const sourceData = sourceNode.data as Record<string, unknown>
        const schemaChildren = (sourceData.children as string[]) || []
        if (!schemaChildren.includes(target)) {
          tx.patchNodeData(source, { children: [...schemaChildren, target] })
        }
        tx.patchNodeData(target, {
          parent: source,
          sourceNodeId: source,
          sourceColumnName: (outputData.columnName as string) || 'Column1',
          saveState: 'draft',
          validationStatus: 'idle',
        })
      }

      // Transform 输入连接：更新上游节点引用
      if (targetNode.type === 'transform' && targetHandle === 'transform-input') {
        let inputColumn: string | undefined

        if (sourceNode.type === 'manualData') {
          const manualData = sourceNode.data as Record<string, unknown>
          inputColumn = (manualData.columnName as string) || 'Column1'
        } else if (sourceNode.type === 'transformOutput') {
          const outputData = sourceNode.data as Record<string, unknown>
          inputColumn = (outputData.columnName as string) || 'Column1'
        } else if (sourceNode.type === 'schema' || sourceNode.type === 'jsonSchema') {
          if (sourceHandle && sourceHandle.startsWith('source-right-')) {
            const columnId = sourceHandle.replace('source-right-', '')
            const schemaData = sourceNode.data as Record<string, unknown>
            const columns = (schemaData.columns as Array<{ id: string; columnName: string }>) || []
            const column = columns.find((c) => c.id === columnId)
            inputColumn = column?.columnName
          }
        }

        const transformData = targetNode.data as Record<string, unknown>
        const currentParams = (transformData.params as Record<string, unknown>) || {}
        const transformType = (transformData.transformType as string) || 'StringSplit'

        // 如果参数为空，自动填充该类型的默认参数
        const nextParams: Record<string, unknown> =
          Object.keys(currentParams).length === 0
            ? transformType === 'StringSplit'
              ? { delimiter: ',', maxsplit: -1 }
              : currentParams
            : currentParams

        tx.patchNodeData(target, {
          inputFromNode: source,
          inputColumn,
          params: nextParams,
          saveState: 'draft',
        })
      }

      tx.commit()

      const pendingEdge = store.edges.find((e) => e.id === edgeId)
      if (pendingEdge) {
        store.edges = store.edges.map((e) =>
          e.id === edgeId ? { ...e, data: { ...e.data, status: 'active' } } : e
        )
      }
    } catch (e) {
      tx.rollback()
      removeEdges(edgeId)
      const errorMsg = e instanceof Error ? e.message : String(e)
      showToastMessage(`连接创建失败，已自动回滚: ${errorMsg}`, 'error')
      logger.error('[handleConnectionCompleted] 连接处理失败:', e)
    }
  }

  /**
   * 验证约束节点的目标句柄是否合法
   *
   * 根据约束类型检查目标句柄是否符合连接规则：
   * - 对于需要 input handle 的约束类型，要求句柄包含 'target-input'
   * - 对于条件约束，要求句柄为 IF 或 THEN 专用句柄
   *
   * @param targetNodeId - 目标节点 ID
   * @param targetNodeType - 目标节点类型，如 'notNullConstraint'
   * @param targetHandle - 目标句柄 ID
   * @returns 句柄是否通过合法性校验
   */
  function isValidConstraintTargetHandle(
    targetNodeId: string,
    targetNodeType: string | undefined,
    targetHandle: string | null | undefined
  ): boolean {
    const constraintType = getConstraintKindByNodeType(targetNodeType)
    if (!constraintType) return true
    if (requiresInputHandle(targetNodeType)) {
      return !!targetHandle && targetHandle.includes('target-input')
    }
    if (constraintType === 'conditional') {
      if (!targetHandle) return false
      const isIfHandle =
        targetHandle === `target-if-${targetNodeId}` ||
        targetHandle.startsWith(`target-if-${targetNodeId}:`)
      const isThenHandle =
        targetHandle.includes(`target-then-${targetNodeId}`) ||
        targetHandle.includes(`target-input-${targetNodeId}`)
      return isIfHandle || isThenHandle
    }
    return true
  }

  return {
    dragStartData,
    onConnectStart,
    handleConnectionCompleted,
    showToastMessage,
    // 导出各个连接处理器的方法，供外部直接调用
    // 通过展开运算符将各子处理器的所有方法合并到返回对象中
    ...schemaConnection,
    ...regexConnection,
    ...foreignKeyConnection,
    ...conditionalConnection,
  }
}
