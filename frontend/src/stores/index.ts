/**
 * @file index.ts
 * @description Stores 统一导出入口
 *
 * 集中导出 frontend/src/stores 目录下的所有 Pinia Store，
 * 便于外部模块通过单一入口按需导入各个 Store。
 *
 * 导出的 Store 包括：
 * - 应用设置：useSettingsStore
 * - 应用模式（IDE/Agent）：useAppModeStore
 * - 画布图状态：useGraphStore
 * - 工作区：useWorkspaceStore
 * - 画布视图：useCanvasStore
 * - 资源树：useResourceTreeStore
 * - 资源文件夹：useResourceFolderStore
 * - 资源搜索：useResourceSearchStore
 * - 设置导航：useSettingsNavStore
 * - 偏好设置：useSettingsPreferencesStore
 * - 项目设置：useProjectSettingsStore
 * - AI 聊天：useAiChatStore
 * - 快捷键：useShortcutStore
 * - 项目管理：useProjectStore
 * - 表达式规则：useExpressionStore
 * - 拖拽状态：useDragStore
 * - 校验任务：useValidationTaskStore
 * - 资源拖拽：useResourceDragStore
 * - 脚本编辑器：useScriptEditorStore
 */

export { useSettingsStore, default as useSettingsStoreDefault } from './settingsStore'
export { useAppModeStore } from './appModeStore'
export { useGraphStore } from './graphStore'
export { useWorkspaceStore } from './workspaceStore'
export { useCanvasStore } from './canvasStore'
export { useResourceTreeStore } from './resourceTreeStore'
export { useResourceFolderStore } from './resourceFolderStore'
export { useResourceSearchStore } from './resourceSearchStore'
export { useAiChatStore } from './aiChatStore'
export { useShortcutStore } from '@/features/keyboard/stores/shortcutStore'
export { useProjectStore } from './projectStore'
export { useExpressionStore } from './expressionStore'
export { useDragStore } from './dragStore'
export { useValidationTaskStore } from './validationTaskStore'
export { useResourceDragStore } from './resourceDragStore'
export { useScriptEditorStore } from './scriptEditorStore'
export { useSettingsNavStore } from './settingsNavStore'
export { useSettingsPreferencesStore } from './settingsPreferencesStore'
export { useProjectSettingsStore } from './projectSettingsStore'
export { useInspectionStore } from './inspectionStore'
