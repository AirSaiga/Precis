<!--
  @file JsonSchemaNodeHeader.vue
  @description JSON Schema 节点头部

  功能概述：
  - JSON 图标标识
  - 表名显示和编辑（点击编辑、Enter 确认、ESC 取消）
  - 数据源连接状态显示
  - 控制按钮：智能填充、保存、关闭

  Props：
  - tableName: string — 表名
  - sourceFile: string | null — 数据源文件路径
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
    JSON Schema节点头部容器
    ========================================
    包含：
    1. 左侧区域：JSON图标 + 表名编辑 + 数据源连接状态
    2. 右侧区域：控制按钮（智能填充、保存、关闭）
  -->
  <div class="node-header">
    <!--
      ========================================
      左侧区域
      ========================================
      包含JSON图标、表名显示/编辑和数据源连接信息
    -->
    <div class="header-left">
      <!--
          ========================================
          表名显示/编辑区域
          ========================================
          支持两种模式：
          1. 显示模式：显示只读表名文本，点击可进入编辑
          2. 编辑模式：显示输入框，支持修改表名
        -->
      <div class="title-input-container">
        <input
          v-if="props.isEditingTitle"
          ref="titleInput"
          v-model="localTableName"
          class="title-input-field"
          @blur="confirmEdit"
          @keydown.enter="onEnter"
          @keydown.esc="emit('cancelEdit')"
          autofocus
          :placeholder="t('customNodes.jsonSchemaNode.tableNamePlaceholder')"
        />
        <span v-else class="table-name-display" @click="emit('startEdit')">
          {{ props.tableName }}
        </span>
      </div>

      <!--
        ========================================
        保存状态指示（草稿角标）
        ========================================
        当 saveState === 'draft' 时显示，提示用户有未保存更改
        对齐 SchemaNodeHeader 的草稿徽标
      -->
      <div
        v-if="props.saveState === 'draft'"
        class="save-state-badge draft-badge"
        :title="t('customNodes.jsonSchemaNode.draftTooltip')"
      >
        <span class="save-state-dot"></span>
        <span class="save-state-text">{{ t('customNodes.jsonSchemaNode.draft') }}</span>
      </div>

      <!--
        ========================================
        数据源连接状态显示
        ========================================
        显示当前Schema节点连接的数据源信息：
        - 已连接：显示文件名，点击可打开数据源选择
        - 未连接：显示提示文本，点击可打开数据源选择
      -->
      <div class="source-section" @click="emit('sourceInfoClick', $event)">
        <span class="source-label">{{ t('customNodes.jsonSchemaNode.source.label') }}:</span>

        <div class="source-info-section">
          <div
            v-if="!props.sourceFile"
            class="source-badge no-source"
            :title="t('customNodes.jsonSchemaNode.source.notConnected')"
          >
            <span class="badge-icon"><AppIcon name="file" :size="16" /></span>
            <span class="badge-text">{{ t('customNodes.jsonSchemaNode.source.noSource') }}</span>
          </div>

          <div
            v-else
            class="source-badge connected"
            :title="t('customNodes.jsonSchemaNode.source.connectedTo', { file: props.sourceFile })"
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
        :title="t('customNodes.jsonSchemaNode.smartFillTooltip')"
      >
        <AppIcon name="sparkles" :size="16" />
      </button>

      <button
        class="header-icon-btn save-btn"
        :class="{ 'is-saving': props.isSaving }"
        @click="emit('save')"
        @mouseenter="saveBtnHovered = true"
        @mouseleave="saveBtnHovered = false"
        :title="t('customNodes.jsonSchemaNode.saveTooltip')"
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
        :title="t('customNodes.jsonSchemaNode.closeTooltip')"
      >
        <AppIcon name="x" :size="18" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
  /**
   * @file JsonSchemaNodeHeader.vue
   * @description JSON Schema节点头部组件
   *
   * 该组件负责渲染JSON Schema节点的头部区域，包含：
   * 1. JSON 图标（{ }）
   * 2. 表名显示和编辑（支持点击编辑、Enter确认、ESC取消）
   * 3. 数据源连接状态显示（显示当前连接的文件信息）
   * 4. 控制按钮：
   *    - 智能填充：自动推断Schema结构
   *    - 保存：保存Schema变更
   *    - 关闭：关闭Schema节点
   *
   * 设计特点：
   * - 纯展示组件，所有用户交互通过events向上传递
   * - 表名编辑支持键盘导航（Enter确认、ESC取消）
   * - 保存按钮具有多种状态显示（保存中、成功、错误）
   * - 数据源信息支持显示/隐藏切换
   */

  // ============================================================================
  // 1. 导入依赖
  // ============================================================================

  import { ref, watch, nextTick } from 'vue'
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
     * 格式："/path/to/file.json" 或 "file.json"
     * 为null表示未连接任何数据源
     */
    sourceFile: string | null
    /**
     * 是否处于表名编辑模式
     * 编辑模式下显示输入框而非文本
     */
    isEditingTitle: boolean
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
     * 'draft' = 草稿（未保存，显示角标提示）
     * 'saved' = 已保存
     * 'error' = 保存出错
     * 对齐 SchemaNodeHeader 的草稿徽标
     */
    saveState?: 'draft' | 'saved' | 'error'
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
     * 开始编辑表名
     * 触发后显示输入框进入编辑模式
     */
    (e: 'startEdit'): void
    /**
     * 确认表名编辑
     * @param name - 新的表名
     */
    (e: 'confirmEdit', name: string): void
    /**
     * 取消表名编辑
     * 恢复原表名，退出编辑模式
     */
    (e: 'cancelEdit'): void
    /**
     * 在编辑时按下Enter键
     * 通常会确认编辑
     */
    (e: 'enter'): void
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
  const localTableName = ref(props.tableName)

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

  /**
   * 表名输入框DOM引用
   * 用于自动聚焦和选中文本
   */
  const titleInput = ref<HTMLInputElement | undefined>()

  // ============================================================================
  // 5. Watchers
  // ============================================================================

  /**
   * 监听表名变化，同步到本地状态
   * 当父组件更新表名时，保持本地状态同步
   */
  watch(
    () => props.tableName,
    (newVal) => {
      localTableName.value = newVal
    }
  )

  /**
   * 监听编辑模式变化
   * 进入编辑模式时，自动聚焦并选中文本
   */
  watch(
    () => props.isEditingTitle,
    (isEditing) => {
      if (isEditing) {
        localTableName.value = props.tableName
        nextTick(() => {
          titleInput.value?.focus()
          titleInput.value?.select()
        })
      }
    }
  )

  // ============================================================================
  // 6. 方法定义
  // ============================================================================

  /**
   * 确认表名编辑
   * 如果新名称有效且与原名称不同，则发送confirmEdit事件
   * 否则取消编辑
   */
  function confirmEdit(): void {
    if (localTableName.value.trim() && localTableName.value !== props.tableName) {
      emit('confirmEdit', localTableName.value.trim())
    } else {
      emit('cancelEdit')
    }
  }

  /**
   * 处理Enter键按下
   * 发送enter事件，通常会确认编辑
   */
  function onEnter(): void {
    emit('enter')
  }
</script>

<style scoped src="./JsonSchemaNodeHeader.styles.css"></style>
