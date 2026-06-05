<!--
  @file JsonSchemaNodeColumnRow.vue
  @description JSON Schema 列行展示组件

  功能概述：
  - 渲染单列的完整 UI（展开/折叠、列名、JSONPath、类型、约束）
  - 支持嵌套列的展开/折叠
  - 支持列名编辑（点击编辑、Enter 确认、ESC 取消、Tab 切换）
  - 显示约束状态（NOT NULL、UNIQUE）

  Props：
  - column: JsonSchemaColumn — 列定义数据
  - index: number — 列在表中的索引
  - depth: number — 列的嵌套深度
  - isEditing: boolean — 是否处于编辑模式
  - isHovered: boolean — 是否悬停
  - showConstraintMenu: boolean — 是否显示约束菜单

  Emits：
  - startEdit: 开始编辑列名
  - confirmEdit: 确认列名编辑
  - cancelEdit: 取消列名编辑
  - delete: 删除列
  - hover: 鼠标进入列
  - unhover: 鼠标离开列
  - hoverError: 鼠标进入错误区域
  - unhoverError: 鼠标离开错误区域
  - toggleConstraintMenu: 切换约束菜单
  - toggleTypeDropdown: 切换类型下拉菜单
  - toggleExpand: 切换展开/折叠状态
  - enter: 按下 Enter 键
  - tab: 按下 Tab 键
-->
<template>
  <!--
    ========================================
    JSON Schema列定义行容器
    ========================================
    功能：
    1. 整体行容器，包含列的所有UI元素
    2. 根据列状态动态应用样式类
       - row-error: 存在验证错误时显示红色背景
       - row-expanded: 列已展开时显示子列
       - is-editing: 编辑模式时应用悬停效果
       - row-hover: 鼠标悬停时高亮
    3. 支持嵌套列的展开/折叠
    4. 显示 JSONPath 路径
  -->
  <div
    class="column-row"
    :class="{
      'row-error': props.column.validationErrors && props.column.validationErrors.length > 0,
      'row-expanded': props.column.isExpanded,
      'is-editing': props.isEditing,
      'row-hover': props.isHovered,
      'has-children': hasChildren,
      'is-nested': isNested,
    }"
    :data-column-id="props.column.id"
    @mouseenter="emit('hover', props.column.id)"
    @mouseleave="emit('unhover')"
  >
    <!--
      ========================================
      展开/折叠图标（仅对有子列的列显示）
      ========================================
      点击可展开/折叠子列
    -->
    <button
      v-if="hasChildren"
      class="expand-toggle-btn"
      :class="{ 'is-expanded': props.column.isExpanded }"
      @click.stop="emit('toggleExpand', props.column.id)"
      :title="
        props.column.isExpanded
          ? t('customNodes.jsonSchemaNode.collapse')
          : t('customNodes.jsonSchemaNode.expand')
      "
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <polyline points="9 18 15 12 9 6"></polyline>
      </svg>
    </button>
    <div v-else class="expand-spacer"></div>

    <!--
      ========================================
      列名编辑区域
      ========================================
      包含两种模式：
      1. 编辑模式：显示输入框，支持修改列名
      2. 显示模式：显示只读列名文本，点击可进入编辑
      包含错误指示器，当列存在验证错误时显示警告图标
    -->
    <div
      class="column-name-wrapper"
      @mouseenter="emit('hoverError', props.column.id)"
      @mouseleave="emit('unhoverError')"
    >
      <input
        v-if="props.isEditing"
        :ref="(el) => setInputRef(el, props.column.id)"
        v-model="localColumnName"
        class="column-name-input"
        :class="{ 'input-error': !isValidName && localColumnName.length > 0 }"
        @blur="confirmEdit"
        @keydown.enter="onEnter"
        @keydown.esc="cancelEdit"
        @keydown.tab="onTab"
        :placeholder="t('customNodes.jsonSchemaNode.columnName.placeholder')"
      />
      <span
        v-else
        class="column-name-text"
        @click="emit('startEdit', props.column.id)"
        :class="{
          'has-errors': props.column.validationErrors && props.column.validationErrors.length > 0,
        }"
      >
        {{ props.column.columnName }}
      </span>

      <span
        v-if="props.column.validationErrors && props.column.validationErrors.length > 0"
        class="error-indicator"
      >
        ⚠️
      </span>
    </div>

    <!--
      ========================================
      JSONPath 显示区域
      ========================================
      显示当前列的 JSONPath 路径
      格式：$.field.subfield
    -->
    <div class="jsonpath-display" :title="props.column.jsonPath">
      <code class="jsonpath-code">{{ props.column.jsonPath }}</code>
    </div>

    <!--
      ========================================
      数据类型选择器
      ========================================
      显示当前列的数据类型，点击可打开类型下拉菜单
      根据数据类型显示不同的颜色样式
    -->
    <div class="type-selector-wrapper">
      <div
        class="type-capsule"
        :class="`type-${props.column.dataType.toLowerCase()}`"
        @click="(e) => emit('toggleTypeDropdown', props.column.id, e)"
      >
        <span class="type-text">{{ getTypeDisplayText(props.column.dataType) }}</span>
        <span class="dropdown-arrow">▼</span>
      </div>

      <!--
        ========================================
        数组元素类型显示（仅当类型为array时显示）
        ========================================
        显示数组元素的数据类型
      -->
      <div
        v-if="props.column.dataType === 'array' && props.column.arrayItemType"
        class="items-type-badge"
        :title="t('customNodes.jsonSchemaNode.dataTypes.arrayItem')"
      >
        <span class="items-type-text">{{ getTypeDisplayText(props.column.arrayItemType) }}</span>
      </div>
    </div>

    <!--
      ========================================
      约束状态显示区
      ========================================
      显示列的约束状态：
      - not-null: 显示禁止图标(红圈)
      - unique: 显示指纹图标(绿圈)
      - 无约束: 显示+按钮用于添加约束
      点击可打开约束菜单
    -->
    <div class="column-constraints">
      <span
        v-if="props.column.constraints?.notNull"
        class="constraint-badge not-null-badge"
        :class="{ 'has-menu': props.showConstraintMenu }"
        @click.stop="emit('toggleConstraintMenu', props.column.id, $event)"
        :title="t('customNodes.jsonSchemaNode.constraints.notNull')"
      >
        <i class="fa-solid fa-ban"></i>
      </span>

      <span
        v-if="props.column.constraints?.unique"
        class="constraint-badge unique-badge"
        :class="{ 'has-menu': props.showConstraintMenu }"
        @click.stop="emit('toggleConstraintMenu', props.column.id, $event)"
        :title="t('customNodes.jsonSchemaNode.constraints.unique')"
      >
        <i class="fa-solid fa-fingerprint"></i>
      </span>

      <button
        v-if="!props.column.constraints?.notNull && !props.column.constraints?.unique"
        class="add-constraint-btn"
        @click.stop="emit('toggleConstraintMenu', props.column.id, $event)"
        :title="t('customNodes.jsonSchemaNode.constraints.addConstraint')"
      >
        +
      </button>
    </div>

    <!--
      ========================================
      行操作区域
      ========================================
      包含：
      1. 源连接点：用于从该列拖出连接到其他节点
      2. 删除按钮：悬停或编辑时显示，用于删除该列
    -->
    <div class="row-actions">
      <button
        v-show="props.isHovered || props.isEditing"
        class="action-btn delete-btn"
        @click="emit('delete', props.column.id)"
        :title="t('customNodes.jsonSchemaNode.actions.deleteColumn')"
      >
        ×
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
  /**
   * @file JsonSchemaNodeColumnRow.vue
   * @description JSON Schema节点列定义行组件
   *
   * 该组件是JSON Schema节点中单个列的完整UI表示，负责渲染和管理列的：
   * 1. 展开/折叠功能（支持嵌套列）
   * 2. 列名编辑（支持点击编辑、回车确认、ESC取消、Tab切换）
   * 3. JSONPath 显示
   * 4. 数据类型显示与选择（包括数组元素类型）
   * 5. 约束状态显示（NOT NULL、UNIQUE）
   * 6. 错误状态显示
   * 7. 删除操作
   *
   * 设计特点：
   * - 纯展示组件，所有业务逻辑通过props和events向上传递
   * - 支持嵌套列的展开/折叠
   * - 支持键盘导航（Enter确认、Esc取消、Tab切换）
   * - 丰富的悬停和焦点交互反馈
   * - JSONPath 路径显示，便于理解数据结构
   */

  // ============================================================================
  // 1. 导入依赖
  // ============================================================================

  import { ref, watch, computed } from 'vue'
  import type { ComponentPublicInstance } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { JsonSchemaColumn } from '@/types/graph'

  // ============================================================================
  // 2. Props 定义
  // ============================================================================

  /**
   * 列定义数据
   * 包含列的所有属性：ID、名称、数据类型、约束、验证状态、JSONPath 等
   */
  const props = defineProps<{
    column: JsonSchemaColumn
    /**
     * 列在表中的索引位置(0-based)
     * 用于显示行序号
     */
    index: number
    /**
     * 列的嵌套深度
     * 根级列为 0，子列依次递增
     */
    depth?: number
    /**
     * 是否处于列名编辑模式
     * 编辑模式下显示输入框而非文本
     */
    isEditing: boolean
    /**
     * 是否鼠标悬停在该行
     * 控制连接句柄和删除按钮的显示
     */
    isHovered: boolean
    /**
     * 是否显示约束菜单
     * 高亮当前列的约束图标
     */
    showConstraintMenu: boolean
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
     * 开始编辑指定列的列名
     * @param columnId - 要编辑的列ID
     */
    (e: 'startEdit', columnId: string): void
    /**
     * 确认列名编辑
     * @param columnId - 编辑的列ID
     * @param name - 新的列名
     */
    (e: 'confirmEdit', columnId: string, name: string): void
    /**
     * 取消列名编辑
     * @param columnId - 取消编辑的列ID
     */
    (e: 'cancelEdit', columnId: string): void
    /**
     * 删除指定列
     * @param columnId - 要删除的列ID
     */
    (e: 'delete', columnId: string): void
    /**
     * 鼠标进入该列区域
     * @param columnId - 进入的列ID
     */
    (e: 'hover', columnId: string): void
    /**
     * 鼠标离开该列区域
     */
    (e: 'unhover'): void
    /**
     * 鼠标进入错误区域
     * @param columnId - 进入的列ID
     */
    (e: 'hoverError', columnId: string): void
    /**
     * 鼠标离开错误区域
     */
    (e: 'unhoverError'): void
    /**
     * 打开/关闭约束菜单
     * @param columnId - 操作的列ID
     * @param event - 鼠标事件
     */
    (e: 'toggleConstraintMenu', columnId: string, event: MouseEvent): void
    /**
     * 打开/关闭类型下拉菜单
     * @param columnId - 操作的列ID
     * @param event - 鼠标事件
     */
    (e: 'toggleTypeDropdown', columnId: string, event: MouseEvent): void
    /**
     * 切换列的展开/折叠状态
     * @param columnId - 操作的列ID
     */
    (e: 'toggleExpand', columnId: string): void
    /**
     * 在编辑时按下Enter键
     */
    (e: 'enter'): void
    /**
     * 在编辑时按下Tab键
     */
    (e: 'tab'): void
  }>()

  // ============================================================================
  // 4. 响应式状态
  // ============================================================================

  /**
   * 国际化翻译函数
   */
  const { t } = useI18n()

  /**
   * 本地列名状态
   * 用于编辑时的双向绑定，编辑确认后才更新父组件
   */
  const localColumnName = ref(props.column.columnName)

  /**
   * 输入框DOM引用字典
   * 通过ID索引，支持聚焦特定列的输入框
   */
  const inputRefs = ref<Record<string, HTMLInputElement | undefined>>({})

  /**
   * 监听列名变化，同步到本地状态
   * 当父组件更新列名时（如外部修改），保持本地状态同步
   */
  watch(
    () => props.column.columnName,
    (newVal) => {
      localColumnName.value = newVal
    }
  )

  // ============================================================================
  // 5. 计算属性
  // ============================================================================

  /**
   * 检查该列是否有子列（嵌套列）
   */
  const hasChildren = computed(() => {
    return props.column.children && props.column.children.length > 0
  })

  /**
   * 检查该列是否嵌套（深度大于0）
   */
  const isNested = computed(() => {
    return (props.depth || 0) > 0
  })

  /**
   * 验证列名是否有效
   * 验证规则：
   * 1. 不能为空
   * 2. 不能以数字开头
   * 3. 必须符合标识符命名规则(字母/下划线开头，后续可含数字)
   * 4. 长度不能超过50字符
   */
  const isValidName = computed(() => {
    if (!localColumnName.value.trim()) return false
    if (/^\d/.test(localColumnName.value)) return false
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(localColumnName.value)) return false
    return localColumnName.value.length <= 50
  })

  // ============================================================================
  // 6. 方法定义
  // ============================================================================

  /**
   * 设置输入框DOM引用
   * @param el - DOM元素
   * @param id - 列ID
   */
  function setInputRef(el: Element | ComponentPublicInstance | null | undefined, id: string): void {
    if (el && '$el' in el) {
      inputRefs.value[id] = el.$el as HTMLInputElement
    } else if (el && (el as Element).tagName) {
      inputRefs.value[id] = el as HTMLInputElement
    }
  }

  /**
   * 确认列名编辑
   * 发送confirmEdit事件通知父组件保存新名称
   */
  function confirmEdit(): void {
    emit('confirmEdit', props.column.id, localColumnName.value.trim())
  }

  /**
   * 取消列名编辑
   * 恢复本地状态为原始列名，并发送cancelEdit事件
   */
  function cancelEdit(): void {
    localColumnName.value = props.column.columnName
    emit('cancelEdit', props.column.id)
  }

  /**
   * 处理Enter键按下
   * 发送enter事件，通常会确认编辑并移动到下一个输入框
   */
  function onEnter(): void {
    emit('enter')
  }

  /**
   * 处理Tab键按下
   * 发送tab事件，通常会确认编辑并移动到上一个/下一个列
   */
  function onTab(): void {
    emit('tab')
  }

  /**
   * 获取数据类型的显示文本
   * 将完整类型名称映射为简短的显示文本
   * @param type - 完整数据类型
   * @returns 简短显示文本
   */
  function getTypeDisplayText(type: string): string {
    const displayMap: Record<string, string> = {
      string: 'String',
      integer: 'Int',
      number: 'Number',
      boolean: 'Boolean',
      object: 'Object',
      array: 'Array',
      null: 'Null',
    }
    return displayMap[type] || type
  }
</script>

<style scoped src="./JsonSchemaNodeColumnRow.styles.css" />
