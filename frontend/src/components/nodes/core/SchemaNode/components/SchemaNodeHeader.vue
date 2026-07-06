<!--
  @file SchemaNodeHeader.vue
  @description Schema 节点头部（表名、数据源图标、控制按钮）

  功能概述：
  - 表名显示和编辑（点击编辑、Enter 确认、ESC 取消）
  - 数据源连接状态显示
  - 控制按钮：智能填充、保存、关闭

  Props：
  - tableName: string — 表名
  - sourceFile: string | null — 数据源文件路径
  - sheetName: string — 工作表名称
  - isEditingTitle: boolean — 是否处于表名编辑模式
  - isSaving: boolean — 是否正在保存
  - saveSuccess: boolean — 保存是否成功
  - saveError: boolean — 保存是否出错

  Emits：
  - startEdit: 开始编辑表名
  - confirmEdit: 确认表名编辑
  - cancelEdit: 取消表名编辑
  - enter: 按下 Enter 键
  - save: 保存 Schema 变更
  - smartFill: 触发智能填充
  - close: 关闭节点
  - sourceInfoClick: 点击数据源信息
-->
<template>
  <!--
    ========================================
    Schema节点头部容器
    ========================================
    包含：
    1. 左侧区域：表名编辑 + 数据源连接状态
    2. 右侧区域：控制按钮（智能填充、保存、关闭）
  -->
  <div class="node-header">
    <!--
      ========================================
      左侧区域
      ========================================
      包含表名显示/编辑和数据源连接信息
    -->
    <div class="header-left">
      <!--
        ========================================
        表名显示区域
        ========================================
        显示只读表名文本
      -->
      <span class="table-name-display">
        {{ props.tableName }}
      </span>

      <!--
        ========================================
        保存状态指示
        ========================================
        显示当前Schema节点的保存状态
      -->
      <div
        v-if="props.saveState === 'draft'"
        class="save-state-badge draft-badge"
        :title="t('customNodes.schemaNode.draftTooltip')"
      >
        <span class="save-state-dot"></span>
        <span class="save-state-text">{{ t('customNodes.schemaNode.draft') }}</span>
      </div>

      <!--
        ========================================
        数据源连接状态显示
        ========================================
        显示当前Schema节点连接的数据源信息：
        - 已连接：显示文件名和工作表名，点击可打开数据源选择
        - 未连接：显示提示文本，点击可打开数据源选择
      -->
      <div class="source-section" @click="emit('sourceInfoClick', $event)">
        <span class="source-label">{{ t('customNodes.schemaNode.source.label') }}:</span>

        <div class="source-info-section">
          <div
            v-if="!props.sourceFile"
            class="source-badge no-source"
            :title="t('customNodes.schemaNode.source.notConnected')"
          >
            <span class="badge-icon"><AppIcon name="file" :size="16" /></span>
            <span class="badge-text">{{ t('customNodes.schemaNode.source.noSource') }}</span>
          </div>

          <div
            v-else
            class="source-badge connected"
            :title="
              t('customNodes.schemaNode.source.connectedTo', {
                file: props.sourceFile,
                sheet: props.sheetName,
              })
            "
          >
            <span class="badge-icon"><AppIcon name="file-chart" :size="16" /></span>
            <span class="badge-text">{{ props.sourceFile || 'Unknown' }}</span>
            <span class="dropdown-arrow">▼</span>
          </div>
        </div>
      </div>
    </div>

    <!--
      ========================================
      控制按钮区域
      ========================================
      包含三个功能按钮：
      1. 智能填充按钮：自动推断Schema结构
      2. 保存按钮：保存Schema变更
      3. 关闭按钮：关闭Schema节点
    -->
    <div class="control-area">
      <button
        class="header-icon-btn smart-fill-btn"
        @click="emit('smartFill')"
        :title="t('customNodes.schemaNode.smartFillTooltip')"
      >
        <AppIcon name="sparkles" :size="16" />
      </button>

      <button
        class="header-icon-btn save-btn"
        :class="{ 'is-saving': props.isSaving }"
        @click="emit('save')"
        @mouseenter="saveBtnHovered = true"
        @mouseleave="saveBtnHovered = false"
        :title="t('customNodes.schemaNode.saveTooltip')"
      >
        <span v-if="props.isSaving" class="save-icon-loading">⟳</span>
        <span v-else-if="props.saveSuccess" class="save-icon-success"
          ><AppIcon name="check" :size="14"
        /></span>
        <span v-else-if="props.saveError" class="save-icon-error">!</span>
        <span v-else-if="saveBtnHovered" class="save-icon-disk">[⬇]</span>
        <span v-else class="save-icon-dot">[⬇]</span>
      </button>

      <button
        class="header-icon-btn close-btn"
        :class="{ 'is-hovered': closeBtnHovered }"
        @click="emit('close')"
        @mouseenter="closeBtnHovered = true"
        @mouseleave="closeBtnHovered = false"
        :title="t('customNodes.schemaNode.closeTooltip')"
      >
        <AppIcon name="x" :size="18" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
  /**
   * @file SchemaNodeHeader.vue
   * @description Schema节点头部组件
   *
   * 该组件负责渲染Schema节点的头部区域，包含：
   * 1. 表名显示
   * 2. 数据源连接状态显示（显示当前连接的文件/工作表信息）
   * 3. 控制按钮：
   *    - 智能填充：自动推断Schema结构
   *    - 保存：保存Schema变更
   *    - 关闭：关闭Schema节点
   *
   * 设计特点：
   * - 纯展示组件，所有用户交互通过events向上传递
   * - 保存按钮具有多种状态显示（保存中、成功、错误）
   * - 数据源信息支持显示/隐藏切换
   */

  // ============================================================================
  // 1. 导入依赖
  // ============================================================================

  import { ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import AppIcon from '@/components/icons/AppIcon.vue'

  // ============================================================================
  // 2. Props 定义
  // ============================================================================

  /**
   * 表名称
   * 显示在头部左侧，可点击进入编辑模式
   */
  const props = defineProps<{
    tableName: string
    /**
     * 数据源文件路径
     * 格式："/path/to/file.xlsx" 或 "file.csv"
     * 为null表示未连接任何数据源
     */
    sourceFile: string | null
    /**
     * 数据源工作表名称
     * 仅Excel文件有此字段
     */
    sheetName?: string
    /**
     * 数据源完整文件路径
     * 用于显示和引用
     */
    sourceFilePath?: string
    /**
     * 是否正在保存
     * 控制保存按钮的加载动画
     */
    isSaving: boolean
    /**
     * 保存是否成功
     * 成功时显示勾号图标
     */
    saveSuccess: boolean
    /**
     * 保存是否出错
     * 错误时显示感叹号图标
     */
    saveError: boolean
    /**
     * 节点保存状态
     * 'draft' = 草稿（未保存）
     * 'saved' = 已保存
     * 'error' = 保存出错
     */
    saveState?: string
  }>()

  // ============================================================================
  // 3. Events 定义
  // ============================================================================

  /**
   * 组件发出的事件列表
   * 所有用户交互通过事件向上传递给父组件处理
   */
  const emit = defineEmits<{
    /**
     * 保存Schema变更
     */
    (e: 'save'): void
    /**
     * 触发智能填充功能
     * 自动推断Schema结构
     */
    (e: 'smartFill'): void
    /**
     * 关闭Schema节点
     */
    (e: 'close'): void
    /**
     * 点击数据源信息区域
     * 打开数据源选择/管理界面
     * @param event - 鼠标事件对象
     */
    (e: 'sourceInfoClick', event: MouseEvent): void
  }>()

  // ============================================================================
  // 4. 响应式状态
  // ============================================================================

  /**
   * 国际化翻译函数
   */
  const { t } = useI18n()

  /**
   * 本地表名状态
   * 用于编辑时的双向绑定，编辑确认后才更新父组件
   */
  /**
   * 保存按钮是否悬停
   * 控制保存按钮图标显示
   */
  const saveBtnHovered = ref(false)

  /**
   * 关闭按钮是否悬停
   * 控制关闭按钮样式变化
   */
  const closeBtnHovered = ref(false)
</script>

<style scoped src="./SchemaNodeHeader.styles.css"></style>
