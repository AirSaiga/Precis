/**
 * @file useResourceDrag.ts
 * @description 统一拖拽处理组合式函数
 *
 * 功能职责：
 * - 提供统一的拖拽处理逻辑
 * - 管理拖拽状态
 * - 生成拖拽幽灵元素
 */

import { useResourceDragStore, type ResourceDragPayload } from '@/stores/resourceDragStore'
import type { ResourceItem, ResourceDragType, SchemaResource } from '@/types/resource'
export function useResourceDrag() {
  const dragStore = useResourceDragStore()

  /**
   * 创建拖拽幽灵元素
   */
  function createDragGhost(
    event: DragEvent,
    variant: 'schema' | 'pattern' | 'constraint' | 'folder' | 'project',
    label: string
  ): void {
    if (!event.dataTransfer) return

    const ghost = document.createElement('div')
    ghost.style.position = 'fixed'
    ghost.style.top = '-1000px'
    ghost.style.left = '-1000px'
    ghost.style.padding = variant === 'schema' ? '10px 12px' : '8px 10px'
    ghost.style.borderRadius = variant === 'schema' ? '12px' : '999px'
    ghost.style.border = '1px solid rgba(100, 116, 139, 0.35)'
    ghost.style.background = 'rgba(15, 23, 42, 0.06)'
    ghost.style.color = '#0F172A'
    ghost.style.fontSize = '12px'
    ghost.style.fontWeight = '700'
    ghost.style.boxShadow = '0 8px 20px rgba(2, 6, 23, 0.12)'
    ghost.style.backdropFilter = 'blur(6px)'
    ghost.style.zIndex = '9999'
    ghost.textContent = label

    document.body.appendChild(ghost)
    event.dataTransfer.setDragImage(ghost, 12, 12)

    // 幽灵元素需要在DOM中存在才能显示，延时移除
    setTimeout(() => ghost.remove(), 0)
  }

  /**
   * 工具箱拖拽开始
   */
  function handleToolboxDragStart(
    event: DragEvent,
    toolType:
      | 'schema'
      | 'pattern'
      | 'regexExtract'
      | 'constraint'
      | 'projectRoot'
      | 'jsonSchema'
      | 'templateInstance'
  ): void {
    if (!event.dataTransfer) return

    const payload: ResourceDragPayload = {
      type: toolType as ResourceDragType,
      source: 'toolbox',
      label: toolType === 'projectRoot' ? 'Project Root' : toolType,
      meta: { toolType },
    }

    createDragGhost(
      event,
      toolType === 'projectRoot'
        ? 'project'
        : (toolType as unknown as 'schema' | 'pattern' | 'constraint' | 'folder' | 'project'),
      toolType === 'projectRoot' ? 'Project Root' : toolType
    )

    const payloadText = JSON.stringify(payload)
    event.dataTransfer.setData('application/x-project-item', payloadText)
    event.dataTransfer.setData('application/json', payloadText)
    event.dataTransfer.setData('text/plain', payloadText)
    event.dataTransfer.effectAllowed = 'copy'

    dragStore.startDrag(payload)
  }

  /**
   * 资源树条目拖拽开始
   */
  function handleResourceDragStart(event: DragEvent, resource: ResourceItem): void {
    if (!event.dataTransfer) return

    // 构建关联资源信息
    const schemaResource = resource.kind === 'schema' ? (resource as SchemaResource) : null
    const associatedRegexIds = schemaResource?.associatedRegexIds || []
    const associatedConstraintIds = schemaResource?.associatedConstraintIds || []
    const embeddedConstraints = schemaResource?.embeddedConstraints || []
    const implicitRegexFields = schemaResource?.implicitRegexFields || []

    const payload: ResourceDragPayload = {
      type:
        resource.kind === 'template'
          ? ('templateInstance' as ResourceDragType)
          : (resource.kind as ResourceDragType),
      source: 'projectResources',
      label: resource.name,
      meta: { id: resource.id, kind: resource.kind, name: resource.name },
      associatedRegexIds,
      associatedConstraintIds,
      embeddedConstraints,
      implicitRegexFields,
    }

    // 构建标签，显示关联资源数量
    let displayLabel = resource.name
    if (
      resource.kind === 'schema' &&
      (associatedRegexIds.length > 0 ||
        associatedConstraintIds.length > 0 ||
        embeddedConstraints.length > 0)
    ) {
      const parts: string[] = []
      if (embeddedConstraints.length > 0) parts.push(`${embeddedConstraints.length} embedded`)
      if (associatedConstraintIds.length > 0)
        parts.push(`${associatedConstraintIds.length} constraints`)
      if (associatedRegexIds.length > 0) parts.push(`${associatedRegexIds.length} regex`)
      displayLabel = `${resource.name} (${parts.join(', ')})`
    }

    // 根据资源类型确定幽灵元素变体
    const variant =
      resource.kind === 'schema' ? 'schema' : resource.kind === 'pattern' ? 'pattern' : 'constraint'
    createDragGhost(event, variant, displayLabel)

    const payloadText = JSON.stringify(payload)
    event.dataTransfer.setData('application/x-project-item', payloadText)
    event.dataTransfer.setData('application/json', payloadText)
    event.dataTransfer.setData('text/plain', payloadText)
    event.dataTransfer.effectAllowed = 'copy'

    dragStore.startDrag(payload)
  }

  /**
   * 模式文件夹拖拽开始
   */
  function handlePatternFolderDragStart(event: DragEvent, scope: 'patterns'): void {
    if (!event.dataTransfer) return

    const payload: ResourceDragPayload = {
      type: 'patternFolder',
      source: 'projectResources',
      label: `${scope}/`,
      meta: { scope },
    }

    createDragGhost(event, 'folder', `${scope}/`)

    const payloadText = JSON.stringify(payload)
    event.dataTransfer.setData('application/x-project-item', payloadText)
    event.dataTransfer.setData('application/json', payloadText)
    event.dataTransfer.setData('text/plain', payloadText)
    event.dataTransfer.effectAllowed = 'copy'

    dragStore.startDrag(payload)
  }

  /**
   * 约束文件夹拖拽开始
   */
  function handleConstraintFolderDragStart(event: DragEvent): void {
    if (!event.dataTransfer) return

    const payload: ResourceDragPayload = {
      type: 'constraintFolder',
      source: 'projectResources',
      label: 'constraints/',
      meta: { scope: 'constraints' },
    }

    createDragGhost(event, 'folder', 'constraints/')

    const payloadText = JSON.stringify(payload)
    event.dataTransfer.setData('application/x-project-item', payloadText)
    event.dataTransfer.setData('application/json', payloadText)
    event.dataTransfer.setData('text/plain', payloadText)
    event.dataTransfer.effectAllowed = 'copy'

    dragStore.startDrag(payload)
  }

  /**
   * 项目配置拖拽开始
   */
  function handleProjectConfigDragStart(event: DragEvent): void {
    if (!event.dataTransfer) return

    const payload: ResourceDragPayload = {
      type: 'projectConfig',
      source: 'projectResources',
      label: 'project.yaml',
      meta: { kind: 'projectConfig' },
    }

    createDragGhost(event, 'project', 'project.yaml')

    const payloadText = JSON.stringify(payload)
    event.dataTransfer.setData('application/x-project-item', payloadText)
    event.dataTransfer.setData('application/json', payloadText)
    event.dataTransfer.setData('text/plain', payloadText)
    event.dataTransfer.effectAllowed = 'copy'

    dragStore.startDrag(payload)
  }

  /**
   * 通用资源拖拽开始
   */
  function handleGenericResourceDragStart(
    event: DragEvent,
    kind: 'schema' | 'constraint' | 'pattern',
    item: ResourceItem
  ): void {
    if (!event.dataTransfer) return

    const payload: ResourceDragPayload = {
      type: kind,
      source: 'projectResources',
      label: item.name,
      meta: { id: item.id, kind },
    }

    const variant = kind === 'schema' ? 'schema' : kind === 'pattern' ? 'pattern' : 'constraint'
    createDragGhost(event, variant, item.name)

    const payloadText = JSON.stringify(payload)
    event.dataTransfer.setData('application/x-project-item', payloadText)
    event.dataTransfer.setData('application/json', payloadText)
    event.dataTransfer.setData('text/plain', payloadText)
    event.dataTransfer.effectAllowed = 'copy'

    dragStore.startDrag(payload)
  }

  /**
   * 工具箱约束类型拖拽开始
   */
  function handleConstraintTypeDragStart(event: DragEvent, constraintType: string): void {
    if (!event.dataTransfer) return

    const payload: ResourceDragPayload = {
      type: 'constraint',
      source: 'toolbox',
      label: constraintType,
      meta: { constraintType },
    }

    createDragGhost(event, 'constraint', constraintType)

    const payloadText = JSON.stringify(payload)
    event.dataTransfer.setData('application/x-project-item', payloadText)
    event.dataTransfer.setData('application/json', payloadText)
    event.dataTransfer.setData('text/plain', payloadText)
    event.dataTransfer.effectAllowed = 'copy'

    dragStore.startDrag(payload)
  }

  /**
   * 工具箱 Transform 类型拖拽开始
   */
  function handleTransformTypeDragStart(event: DragEvent, transformType: string): void {
    if (!event.dataTransfer) return

    const payload: ResourceDragPayload = {
      type: 'transform',
      source: 'toolbox',
      label: transformType,
      meta: { transformType },
    }

    createDragGhost(event, 'constraint', transformType)

    const payloadText = JSON.stringify(payload)
    event.dataTransfer.setData('application/x-project-item', payloadText)
    event.dataTransfer.setData('application/json', payloadText)
    event.dataTransfer.setData('text/plain', payloadText)
    event.dataTransfer.effectAllowed = 'copy'

    dragStore.startDrag(payload)
  }

  /**
   * 工具箱 Regex 类型拖拽开始
   */
  function handleRegexTypeDragStart(event: DragEvent, regexType: 'pattern' | 'extract'): void {
    if (!event.dataTransfer) return

    const payload: ResourceDragPayload = {
      type: 'regex',
      source: 'toolbox',
      label: regexType === 'extract' ? 'Regex Extract' : 'Regex Pattern',
      meta: { regexType },
    }

    createDragGhost(event, 'pattern', regexType === 'extract' ? 'Regex Extract' : 'Regex Pattern')

    const payloadText = JSON.stringify(payload)
    event.dataTransfer.setData('application/x-project-item', payloadText)
    event.dataTransfer.setData('application/json', payloadText)
    event.dataTransfer.setData('text/plain', payloadText)
    event.dataTransfer.effectAllowed = 'copy'

    dragStore.startDrag(payload)
  }

  /**
   * 工具箱手动数据节点拖拽开始
   */
  function handleManualDataDragStart(event: DragEvent): void {
    if (!event.dataTransfer) return

    const payload: ResourceDragPayload = {
      type: 'manualData',
      source: 'toolbox',
      label: 'Manual Data',
      meta: { toolType: 'manualData' },
    }

    createDragGhost(event, 'schema', 'Manual Data')

    const payloadText = JSON.stringify(payload)
    event.dataTransfer.setData('application/x-project-item', payloadText)
    event.dataTransfer.setData('application/json', payloadText)
    event.dataTransfer.setData('text/plain', payloadText)
    event.dataTransfer.effectAllowed = 'copy'

    dragStore.startDrag(payload)
  }

  /**
   * 拖拽结束
   */
  function handleDragEnd(): void {
    dragStore.endDrag()
  }

  /**
   * 数据源拖拽开始
   */
  function handleDataSourceDragStart(
    event: DragEvent,
    dataSource: {
      id: string
      fileId: string
      name: string
      type: 'excel' | 'csv' | 'json'
      sourceMode?: 'localfile'
      localPath?: string
    }
  ): void {
    if (!event.dataTransfer) return

    const payload: ResourceDragPayload = {
      type: 'external_data_source',
      source: 'dataLibrary',
      label: dataSource.name,
      meta: {
        sourceId: dataSource.id,
        fileId: dataSource.fileId,
        fileName: dataSource.name,
        fileType: dataSource.type,
        sourceMode: dataSource.sourceMode || 'localfile',
        localPath: dataSource.localPath,
      },
    }

    createDragGhost(event, 'folder', dataSource.name)

    const payloadText = JSON.stringify(payload)
    event.dataTransfer.setData('application/json', payloadText)
    event.dataTransfer.setData('text/plain', payloadText)
    event.dataTransfer.effectAllowed = 'copy'

    dragStore.startDrag(payload)
  }

  return {
    // 状态
    isDragging: dragStore.isDragging,
    payload: dragStore.payload,

    // 工具箱拖拽
    handleToolboxDragStart,
    handleConstraintTypeDragStart,
    handleTransformTypeDragStart,
    handleRegexTypeDragStart,
    handleManualDataDragStart,

    // 资源树拖拽
    handleResourceDragStart,
    handleGenericResourceDragStart,

    // 文件夹拖拽
    handlePatternFolderDragStart,
    handleConstraintFolderDragStart,

    // 项目配置拖拽
    handleProjectConfigDragStart,

    // 数据源拖拽
    handleDataSourceDragStart,

    // 拖拽结束
    handleDragEnd,

    // 幽灵元素
    createDragGhost,
  }
}
