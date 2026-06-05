/**
 * @file useCanvasNodeOperations.ts
 * @description 画布节点操作组合式函数
 *
 * 该模块负责处理画布上的节点创建、拖拽、放置等画布级别的操作。
 * 是数据流图中节点管理的基础设施层。
 *
 * 功能概述：
 * 1. 节点创建 - 根据节点类型创建新节点
 * 2. 拖拽处理 - 响应节点的拖拽开始和结束事件
 * 3. 放置处理 - 处理节点在画布上的放置操作
 * 4. 节点点击 - 处理节点的点击选择事件
 * 5. 右键菜单 - 管理右键菜单的显示和位置
 * 6. Toast 提示 - 显示操作结果的临时消息
 *
 * 架构设计：
 * - 使用 VueFlow 的 useVueFlow 获取画布操作方法
 * - 通过 Pinia Store（graphStore, dragStore）管理状态
 * - 将复杂的 DOM 操作和状态管理逻辑封装在 composable 中
 * - 通过返回值暴露响应式状态和操作方法供组件使用
 *
 * 依赖说明：
 * - @vue-flow/core: 图库，提供画布渲染和交互能力
 * - stores/graphStore: 全局图数据状态管理
 * - stores/dragStore: 拖拽状态管理
 * - composables/nodes/sourcePreview: 数据源预览节点创建
 *
 * @param flowWrapper - 画布容器的 DOM 引用，用于计算放置位置等
 * @returns 包含画布节点操作方法和响应式状态的对象
 */

import { logger } from '@/core/utils/logger'
import { ref, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVueFlow, type NodeMouseEvent } from '@vue-flow/core'
import { useGraphStore } from '@/stores/graphStore'
import { useDragStore, type DragEventPayload } from '@/stores/dragStore'
import { useResourceDragStore } from '@/stores/resourceDragStore'
import { useSourcePreview } from '../nodes/sourcePreview'
import { toastError, toastSuccess, toastInfo } from '@/core/toast'
import type { SourcePreviewNodeData } from '@/types/datasource'
import type { ConstraintKind } from '@/services/constraints/types'

/**
 * 画布节点操作组合式函数
 * 负责节点创建、拖拽等画布级别的操作
 *
 * @param flowWrapper - 画布容器 DOM 引用
 * @returns 画布节点操作相关的方法和状态
 */
export function useCanvasNodeOperations(flowWrapper: Ref<HTMLElement | null>) {
  // 获取 i18n 翻译函数
  const { t } = useI18n()

  // 从 VueFlow 获取画布操作方法
  // addNodes: 添加节点, findNode: 查找节点, project: 坐标投影转换
  const { addNodes, findNode, project } = useVueFlow()

  // 获取全局图存储，存储节点和连接状态
  const store = useGraphStore()

  // 获取拖拽存储，管理拖拽过程中的状态
  const dragStore = useDragStore()

  // 获取资源拖拽存储，用于资源树/工具箱拖拽到画布的跨组件状态兜底
  const resourceDragStore = useResourceDragStore()

  // 右键菜单显示状态，false 为隐藏，true 为显示
  const menuVisible = ref(false)

  // 右键菜单位置坐标，存储菜单弹出时的 x、y 坐标
  const menuPos = ref({ x: 0, y: 0 })

  // 使用 SourcePreview composables 创建数据源预览节点
  // 传入空 id 和空数据作为占位符，实际创建时会被替换
  const { createSourcePreviewNode } = useSourcePreview(
    { id: '', data: {} as unknown as SourcePreviewNodeData },
    () => {}
  )

  /**
   * Toast 消息提示函数
   * 在页面右上角显示临时消息，3秒后自动消失
   * @param message - 消息内容，要显示的文本信息
   * @param type - 消息类型，success=成功绿色，error=错误红色，info=信息蓝色
   */
  const showToastMessage = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    if (type === 'success') toastSuccess(message)
    else if (type === 'error') toastError(message)
    else toastInfo(message)
  }

  /**
   * 添加新节点
   * 根据节点类型在画布默认位置创建新节点
   * @param nodeType - 节点类型，如 'schema' 创建表节点
   */
  const addNewNode = (nodeType: string) => {
    // 设置节点默认位置在画布中心偏左上
    const position = { x: 300, y: 250 }
    // 判断节点类型，调用对应的创建方法
    if (nodeType === 'schema') {
      store.createSchemaNode(position)
    }
    // 添加节点后隐藏右键菜单
    menuVisible.value = false
  }

  /**
   * 节点点击处理
   * 当用户点击画布上的节点时触发，更新选中的节点 ID
   * @param event - 节点鼠标事件，包含被点击节点的信息
   */
  const onNodeClick = (event: NodeMouseEvent) => {
    // 如果右键菜单正在显示，先隐藏菜单
    if (menuVisible.value) {
      menuVisible.value = false
    }
    // 将点击的节点 ID 存储到全局 store，供其他组件使用
    store.selectedNodeId = event.node.id
  }

  /**
   * 节点拖拽开始事件处理
   * 当用户开始拖拽节点时调用，记录拖拽数据
   * @param payload - 拖拽数据，包含被拖拽节点的信息
   */
  const handleNodeDragStart = (payload: DragEventPayload) => {
    logger.debug('🔄 NodeCanvas收到节点拖拽开始事件:', payload)
    // 调用 dragStore 的 startDrag 方法开始追踪拖拽状态
    dragStore.startDrag(payload)
  }

  /**
   * 节点拖拽结束事件处理
   * 当用户释放节点时调用，清除拖拽状态
   */
  const handleNodeDragEnd = () => {
    logger.debug('🔄 NodeCanvas收到节点拖拽结束事件')
    // 调用 dragStore 的 endDrag 方法结束拖拽追踪
    dragStore.endDrag()
  }

  /**
   * 画布拖拽悬停事件处理
   * 当拖拽元素经过画布上方时调用，允许放置操作
   * @param event - 拖拽事件
   */
  const onCanvasDragOver = (event: DragEvent) => {
    logger.debug('🔄 onCanvasDragOver被调用')
    // 调用 preventDefault 允许 drop 事件触发
    event.preventDefault()
  }

  /**
   * 画布拖拽释放事件处理
   * 当用户在画布上释放拖拽元素时调用，创建对应的节点
   * @param event - 拖拽事件，包含释放位置和拖拽数据
   */
  const onCanvasDrop = async (event: DragEvent) => {
    logger.debug('🔄 onCanvasDrop被调用')
    // 检查是否有拖拽数据，没有则直接返回
    if (!event.dataTransfer) {
      logger.debug('❌ 没有dataTransfer对象')
      return
    }

    // 阻止默认行为，防止浏览器打开拖拽的文件
    event.preventDefault()

    // 定义变量存储解析后的拖拽数据
    const payloadString =
      event.dataTransfer.getData('application/x-project-item') ||
      event.dataTransfer.getData('application/json') ||
      event.dataTransfer.getData('text/plain')

    let payload: unknown = null

    logger.debug('🔄 尝试获取拖拽数据:', payloadString)

    // 优先解析 DataTransfer 数据；如果浏览器限制自定义 MIME，则回退到资源拖拽全局状态
    if (payloadString) {
      try {
        payload = JSON.parse(payloadString)
      } catch (e) {
        logger.warn('⚠️ 拖拽数据解析失败，回退到资源拖拽状态:', e)
        payload = null
      }
    }

    if (!payload && resourceDragStore.isDragging && resourceDragStore.payload) {
      payload = resourceDragStore.payload
    }

    if (!payload || typeof payload !== 'object') {
      logger.debug('❌ 没有找到可用的拖拽数据')
      return
    }

    logger.debug('🔄 成功解析拖拽数据:', payload)

    // 获取释放位置的画布坐标，需要减去画布容器的偏移量
    if (flowWrapper.value) {
      // 获取画布容器相对于视口的位置信息
      const { top, left } = flowWrapper.value.getBoundingClientRect()
      // 计算鼠标在画布内的相对坐标
      const rawX = event.clientX - left
      const rawY = event.clientY - top
      // 使用 VueFlow 的 project 方法将屏幕坐标转换为画布坐标
      const position = project({ x: rawX, y: rawY })

      // 应用网格对齐，使节点放置位置更加整齐
      const gridSize = 20
      position.x = Math.round(position.x / gridSize) * gridSize
      position.y = Math.round(position.y / gridSize) * gridSize

      logger.debug('🔄 创建节点，位置:', position)

      // 根据拖拽数据类型调用对应的节点创建方法
      await createNodeFromPayload(payload as Record<string, unknown>, position)
    } else {
      logger.debug('❌ flowWrapper.value不存在')
    }
  }

  /**
   * 根据payload创建节点
   * 解析拖拽数据，根据类型创建不同类型的节点
   * @param payload - 拖拽数据对象，包含 type、meta、source 等字段
   * @param position - 节点放置位置坐标
   * @param cascadeFromConstraint - 是否从独立约束级联过来（用于截断判断）
   */
  const createNodeFromPayload = async (
    payload: Record<string, unknown>,
    position: { x: number; y: number },
    cascadeFromConstraint: boolean = false
  ) => {
    // 从 payload 中解构获取类型、元数据和来源
    const {
      type,
      meta,
      source,
      associatedRegexIds,
      associatedConstraintIds,
      embeddedConstraints,
      implicitRegexFields,
    } = payload

    // 类型断言
    const embeddedConstraintsList = embeddedConstraints as
      | Array<{ id: string; name: string }>
      | undefined
    const implicitRegexFieldsList = implicitRegexFields as
      | Array<{ inferredPatternId: string }>
      | undefined

    // 使用 switch 语句根据类型分发到不同的创建逻辑
    switch (type) {
      // ProjectConfig 类型：项目根节点
      case 'projectConfig':
        store.createProjectRootNode(position)
        break

      // ProjectRoot 类型：项目根节点
      case 'projectRoot':
        store.createProjectRootNode(position)
        break

      // PatternFolder 类型：模式工具箱节点
      case 'patternFolder':
        if (meta && typeof meta === 'object' && 'scope' in meta) {
          const scope = String((meta as Record<string, unknown>).scope)
          await store.createPatternToolboxNode(position, scope === 'patterns' ? scope : 'all')
        } else {
          await store.createPatternToolboxNode(position, 'all')
        }
        break

      // ConstraintFolder 类型：约束看板节点
      case 'constraintFolder':
        await store.createConstraintDashboardNode(position)
        break

      // JSON Schema 类型：创建 JSON Schema 节点
      case 'jsonSchema':
        if (source === 'projectResources' && meta && typeof meta === 'object' && 'id' in meta) {
          const schemaId = String((meta as Record<string, unknown>).id)
          await store.importV2ResourceToCanvas('schema', schemaId, position, {
            includeDeps: false,
            moveIfExists: true,
          })
        } else if (source === 'toolbox') {
          // 从工具箱拖拽创建新的 JSON Schema 节点
          store.createJsonSchemaNode(position, t('messages.canvas.newTable'))
        } else {
          // 其他来源，默认创建新节点
          store.createJsonSchemaNode(position, t('messages.canvas.newTable'))
        }
        break

      // Schema 类型：创建表节点
      case 'schema':
        if (source === 'projectResources' && meta && typeof meta === 'object' && 'id' in meta) {
          const schemaId = String((meta as Record<string, unknown>).id)

          // 【主核爆发展开】如果是从独立约束级联过来的，则不触发自身的级联渲染
          if (!cascadeFromConstraint) {
            // 1. 独立约束节点
            if (
              associatedConstraintIds &&
              Array.isArray(associatedConstraintIds) &&
              associatedConstraintIds.length > 0
            ) {
              let offsetY = 160
              // 如果已经有内嵌约束（importV2ResourceToCanvas 会自动处理），从内嵌约束下方开始
              if (embeddedConstraintsList && embeddedConstraintsList.length > 0) {
                offsetY = 160 + embeddedConstraintsList.length * 160
              }
              for (const constraintId of associatedConstraintIds) {
                // 过滤掉内嵌约束（格式为 schemaId_constraintId）
                if (!constraintId.startsWith(`${schemaId}_`)) {
                  const constraintPosition = { x: position.x + 840, y: position.y + offsetY }
                  await store.importV2ResourceToCanvas(
                    'constraint',
                    constraintId,
                    constraintPosition,
                    { includeDeps: false, moveIfExists: true }
                  )
                  offsetY += 160
                }
              }
            }

            // 3. 拉出显式声明绑定的正则节点（排除隐式匹配）
            if (
              associatedRegexIds &&
              Array.isArray(associatedRegexIds) &&
              associatedRegexIds.length > 0
            ) {
              let offsetX = 420
              for (const regexId of associatedRegexIds) {
                // 检查是否为隐式正则（在 implicitRegexFields 中）
                const isImplicit = implicitRegexFieldsList?.some(
                  (f) => f.inferredPatternId === regexId
                )
                if (!isImplicit) {
                  const regexPosition = { x: position.x + offsetX, y: position.y }
                  await store.importV2ResourceToCanvas('regex', regexId, regexPosition, {
                    includeDeps: false,
                    moveIfExists: true,
                  })
                  offsetX += 420
                }
              }
            }
            // 4. 🚫 隐式正则阻断：遇到隐式正则字段不生成任何正则节点（已在上面过滤）
          }

          // 始终创建 Schema 节点本身
          await store.importV2ResourceToCanvas('schema', schemaId, position, {
            includeDeps: false,
            moveIfExists: true,
          })
        } else {
          const label = t('messages.canvas.newTable')
          store.createSchemaNode(position, label)
        }
        break

      // Pattern 类型：正则表达式模式节点 - 【孤岛渲染】
      case 'pattern':
        // 如果来自文件浏览器且有文件路径，记录日志
        if (source === 'projectResources' && meta && typeof meta === 'object' && 'id' in meta) {
          await store.importV2ResourceToCanvas(
            'pattern',
            String((meta as Record<string, unknown>).id),
            position,
            {
              includeDeps: false,
              moveIfExists: true,
            }
          )
        } else if (
          source === 'explorer' &&
          meta &&
          typeof meta === 'object' &&
          'localPath' in meta
        ) {
          logger.debug('从文件加载正则表达式:', (meta as Record<string, unknown>).localPath)
        } else {
          // 否则创建新的空白正则模式节点
          store.createRegexNode(position, '', t('messages.canvas.newPattern'))
        }
        break

      // Transform 类型：转换节点
      case 'transform':
        if (source === 'projectResources' && meta && typeof meta === 'object' && 'id' in meta) {
          await store.importV2ResourceToCanvas(
            'transform',
            String((meta as Record<string, unknown>).id),
            position,
            {
              includeDeps: false,
              moveIfExists: true,
            }
          )
        } else if (
          source === 'toolbox' &&
          meta &&
          typeof meta === 'object' &&
          'transformType' in meta
        ) {
          const transformType = String((meta as Record<string, unknown>).transformType)
          store.createTransformNode(
            position,
            transformType as
              | 'StringSplit'
              | 'RegexExtract'
              | 'MathExpr'
              | 'DateFormat'
              | 'Lookup'
              | 'Strip'
              | 'UpperCase'
              | 'LowerCase'
              | 'Replace'
              | 'FilterRows'
              | 'FillNA'
              | 'DropDuplicates'
              | 'CastType'
              | 'Concat'
              | 'Substring'
              | 'Aggregate'
              | 'ConditionalAssign'
              | 'SortRows'
          )
        } else {
          store.createTransformNode(position, 'StringSplit')
        }
        break

      // ManualData 类型：手动数据节点
      case 'manualData':
        store.createManualDataNode(position)
        break

      // TemplateInstance 类型：模板实例节点
      case 'templateInstance':
        if (
          source === 'projectResources' &&
          meta &&
          typeof meta === 'object' &&
          'id' in meta
        ) {
          store.createTemplateInstanceNode(
            position,
            String((meta as Record<string, unknown>).id),
            String((meta as Record<string, unknown>).name || '')
          )
        } else if (
          source === 'toolbox' &&
          meta &&
          typeof meta === 'object' &&
          'templateId' in meta
        ) {
          store.createTemplateInstanceNode(
            position,
            String((meta as Record<string, unknown>).templateId),
            String((meta as Record<string, unknown>).templateName || '')
          )
        } else {
          store.createTemplateInstanceNode(position)
        }
        break

      // RegexNode 类型：从资源树拖拽的正则表达式节点 - 【孤岛渲染】
      case 'regex_node':
        if (source === 'projectResources' && meta && typeof meta === 'object' && 'id' in meta) {
          await store.importV2ResourceToCanvas(
            'regex',
            String((meta as Record<string, unknown>).id),
            position,
            {
              includeDeps: false,
              moveIfExists: true,
            }
          )
        } else {
          store.createRegexNode(position, '', t('messages.canvas.newRegex'))
        }
        break

      // Constraint 类型：约束节点
      case 'constraint':
        if (source === 'toolbox' && meta && typeof meta === 'object' && 'constraintType' in meta) {
          const constraintType = String((meta as Record<string, unknown>).constraintType)
          store.createConstraintNode(position, constraintType as ConstraintKind)
        } else if (
          source === 'projectResources' &&
          meta &&
          typeof meta === 'object' &&
          'id' in meta
        ) {
          const constraintId = String((meta as Record<string, unknown>).id)
          // 统一走标准资源导入路径，FK 展示边已在 importConstraint 中自动补齐
          await store.importV2ResourceToCanvas('constraint', constraintId, position, {
            includeDeps: true,
            moveIfExists: true,
          })
        } else {
          store.createConstraintNode(position, 'foreignKey')
        }
        break

      // Source 类型：数据源预览节点
      case 'source':
        // 检查来源和元数据有效性
        if (source === 'explorer' && meta && typeof meta === 'object' && 'localPath' in meta) {
          // 调用 SourcePreview composables 的创建方法
          createSourcePreviewNode(meta as Record<string, unknown>, position)
        }
        break

      // ExternalDataSource 类型：外部数据源节点
      case 'external_data_source':
        logger.debug('处理外部数据源拖拽:', payload)

        if (payload && typeof payload === 'object') {
          const fileId = String((payload as Record<string, unknown>).fileId || '')
          const fileName = String(
            (payload as Record<string, unknown>).fileName ||
              (payload as Record<string, unknown>).name ||
              ''
          )
          const name = String((payload as Record<string, unknown>).name || '')
          const fileType = String((payload as Record<string, unknown>).fileType || 'csv')
          const sourceId = String((payload as Record<string, unknown>).sourceId || '')
          const label = String((payload as Record<string, unknown>).label || '')
          const sourceMode = String((payload as Record<string, unknown>).sourceMode || 'localfile')
          const localPath = String((payload as Record<string, unknown>).localPath || '')

          logger.debug('🔍 拖拽数据源详情:', {
            fileId,
            fileName,
            name,
            fileType,
            sourceId,
            label,
            sourceMode,
            localPath,
          })

          if (fileId && fileType) {
            // 根据文件类型创建不同的预览节点
            if (fileType === 'json') {
              // JSON 文件使用专门的 JsonSourcePreview 节点
              const jsonFileInfo = {
                fileId: fileId,
                fileName: fileName || name || fileId,
                sourceMode: sourceMode as 'localfile',
                localPath: localPath || fileId,
                format: 'json',
                jsonPath: '',
                recordPath: '',
              }
              logger.debug('🔍 创建 JSON 预览节点:', jsonFileInfo)
              store.createJsonSourcePreviewNode(name || fileName || fileId, position, jsonFileInfo)
            } else {
              // Excel/CSV 文件使用普通的 SourcePreview 节点
              const externalSourceMeta = {
                fileId: fileId,
                fileName: fileName || name || fileId,
                fileType: fileType,
                sourceId: sourceId,
                sourceName: name || fileName || fileId,
                sourceType: fileType,
                label: label,
                sourceMode: sourceMode,
                localPath: localPath,
              }
              logger.debug('🔍 构建 externalSourceMeta:', externalSourceMeta)
              createSourcePreviewNode(externalSourceMeta, position)
            }
          } else {
            toastError(
              t('messages.import.externalDataSourceIncomplete'),
              t('messages.import.importFailed')
            )
          }
        }
        break

      // 默认情况：未知类型，记录警告日志
      default:
        logger.warn('未知的节点类型:', type)
    }
  }

  return {
    menuVisible,
    menuPos,
    addNewNode,
    onNodeClick,
    handleNodeDragStart,
    handleNodeDragEnd,
    onCanvasDragOver,
    onCanvasDrop,
    createNodeFromPayload,
    showToastMessage,
  }
}
