<!--
  @file JsonSchemaNodeColumnMenuDropdown.vue
  @description JSON Schema 列下拉菜单

  功能概述：
  - 统一处理列相关的下拉菜单展示
  - 约束菜单：设置非空、唯一约束
  - 类型菜单：选择数据类型
  - 数组元素类型菜单：选择数组元素的数据类型

  Props：
  - show: boolean — 是否显示下拉菜单
  - menuType: 'constraint' | 'type' | 'itemsType' — 菜单类型
  - position: { top: number; left: number } — 菜单位置
  - columnId: string — 当前列 ID
  - constraints: ColumnConstraints — 当前列的约束配置
  - currentType: string — 当前列的数据类型
  - currentItemsType: string — 当前数组元素类型
  - typeOptions: TypeOption[] — 类型选项列表

  Emits：
  - close: 关闭菜单
  - toggleConstraint: 切换约束状态
  - removeAllConstraints: 移除所有约束
  - selectType: 选择数据类型
  - selectItemsType: 选择数组元素类型
-->
<template>
  <Teleport to="body">
    <template v-if="props.show">
      <div class="dropdown-backdrop" @click="emit('close')"></div>

      <!--
        ========================================
        约束菜单
        ========================================
        用于设置非空、唯一约束
      -->
      <div
        v-if="menuType === 'constraint'"
        class="constraint-dropdown fixed-dropdown"
        :style="{
          top: `${position.top}px`,
          left: `${position.left}px`,
        }"
        @click.stop
      >
        <div class="constraint-menu-header">
          {{ t('customNodes.jsonSchemaNode.constraints.title') }}
        </div>

        <div
          class="constraint-menu-item"
          :class="{ active: constraints?.notNull, disabled: constraints?.notNull }"
          @click="handleToggle('notNull')"
        >
          <span class="constraint-icon not-null-icon">
            <i class="fa-solid fa-ban"></i>
          </span>
          <span class="constraint-label">{{
            t('customNodes.jsonSchemaNode.constraints.notNull')
          }}</span>
          <span v-if="constraints?.notNull" class="check-icon">✓</span>
        </div>

        <div
          class="constraint-menu-item"
          :class="{ active: constraints?.unique, disabled: constraints?.unique }"
          @click="handleToggle('unique')"
        >
          <span class="constraint-icon unique-icon">
            <i class="fa-solid fa-fingerprint"></i>
          </span>
          <span class="constraint-label">{{
            t('customNodes.jsonSchemaNode.constraints.unique')
          }}</span>
          <span v-if="constraints?.unique" class="check-icon">✓</span>
        </div>

        <div class="constraint-menu-divider"></div>

        <div
          v-if="constraints?.notNull || constraints?.unique"
          class="constraint-menu-item remove-option"
          @click="handleRemoveAll"
        >
          <span class="constraint-icon">
            <i class="fa-solid fa-trash"></i>
          </span>
          <span class="constraint-label">{{
            t('customNodes.jsonSchemaNode.constraints.removeAll')
          }}</span>
        </div>
      </div>

      <!--
        ========================================
        类型菜单
        ========================================
        用于选择数据类型
      -->
      <div
        v-else-if="menuType === 'type'"
        class="type-dropdown fixed-dropdown"
        :style="{
          top: `${position.top}px`,
          left: `${position.left}px`,
        }"
        @click.stop
      >
        <div
          v-for="typeOption in resolvedTypeOptions"
          :key="typeOption.value"
          class="type-option-row"
        >
          <button
            type="button"
            class="type-option-pill"
            :class="[
              `type-${typeOption.value.toLowerCase()}`,
              { selected: currentType === typeOption.value },
            ]"
            @click="handleSelectType(typeOption.value)"
          >
            {{ typeOption.label }}
          </button>
        </div>
      </div>

      <!--
        ========================================
        数组元素类型菜单
        ========================================
        仅当列类型为 array 时显示
        用于选择数组元素的数据类型
      -->
      <div
        v-else-if="menuType === 'itemsType'"
        class="type-dropdown fixed-dropdown"
        :style="{
          top: `${position.top}px`,
          left: `${position.left}px`,
        }"
        @click.stop
      >
        <div class="constraint-menu-header">
          {{ t('customNodes.jsonSchemaNode.itemsType') }}
        </div>

        <div v-for="typeOption in itemsTypeOptions" :key="typeOption.value" class="type-option-row">
          <button
            type="button"
            class="type-option-pill"
            :class="[
              `type-${typeOption.value.toLowerCase()}`,
              { selected: currentItemsType === typeOption.value },
            ]"
            @click="handleSelectItemsType(typeOption.value)"
          >
            {{ typeOption.label }}
          </button>
        </div>
      </div>
    </template>
  </Teleport>
</template>

<script setup lang="ts">
  /**
   * @file JsonSchemaNodeColumnMenuDropdown.vue
   * @description JSON Schema节点列菜单下拉组件
   *
   * 该组件统一处理列相关的下拉菜单：
   * 1. 约束菜单：设置非空、唯一约束
   * 2. 类型菜单：选择数据类型
   * 3. 数组元素类型菜单：选择数组元素的数据类型
   *
   * JSON Schema 特有功能：
   * - 支持数组元素类型选择
   * - 支持 object 和 array 等复杂类型
   */

  /**
   * 菜单类型
   */
  type MenuType = 'constraint' | 'type' | 'itemsType'

  /**
   * 约束配置接口
   */
  interface ColumnConstraints {
    notNull?: boolean
    unique?: boolean
  }

  /**
   * 数据类型选项
   */
  interface TypeOption {
    value: string
    label: string
  }

  // ============================================================================
  // Props 定义
  // ============================================================================

  /**
   * 组件属性
   */
  const props = defineProps<{
    show: boolean
    menuType: MenuType
    position: { top: number; left: number }
    columnId: string
    constraints?: ColumnConstraints
    currentType?: string
    currentItemsType?: string
    typeOptions?: TypeOption[]
  }>()

  // ============================================================================
  // Events 定义
  // ============================================================================

  /**
   * 组件事件
   */
  const emit = defineEmits<{
    (e: 'close'): void
    (e: 'toggleConstraint', columnId: string, constraintType: 'notNull' | 'unique'): void
    (e: 'removeAllConstraints', columnId: string): void
    (e: 'selectType', columnId: string, type: string): void
    (e: 'selectItemsType', columnId: string, type: string): void
  }>()

  // ============================================================================
  // 响应式数据
  // ============================================================================

  /**
   * 国际化翻译函数
   */
  const { t } = useI18n()

  /**
   * 默认数据类型选项
   */
  const defaultTypeOptions: TypeOption[] = [
    { value: 'string', label: 'String' },
    { value: 'integer', label: 'Int' },
    { value: 'number', label: 'Number' },
    { value: 'boolean', label: 'Boolean' },
    { value: 'object', label: 'Object' },
    { value: 'array', label: 'Array' },
    { value: 'null', label: 'Null' },
  ]

  /**
   * 数组元素类型选项
   */
  const itemsTypeOptions: TypeOption[] = [
    { value: 'string', label: 'String' },
    { value: 'integer', label: 'Int' },
    { value: 'number', label: 'Number' },
    { value: 'boolean', label: 'Boolean' },
    { value: 'object', label: 'Object' },
  ]

  /**
   * 类型下拉选项
   * - 父组件未传入时，使用默认选项
   */
  const resolvedTypeOptions = computed<TypeOption[]>(() => {
    if (props.typeOptions && props.typeOptions.length > 0) return props.typeOptions
    return defaultTypeOptions
  })

  // ============================================================================
  // 方法定义
  // ============================================================================

  /**
   * 处理约束切换
   * @param constraintType - 约束类型
   */
  function handleToggle(constraintType: 'notNull' | 'unique'): void {
    if (props.constraints?.[constraintType]) return
    emit('toggleConstraint', props.columnId, constraintType)
  }

  /**
   * 处理移除所有约束
   */
  function handleRemoveAll(): void {
    emit('removeAllConstraints', props.columnId)
  }

  /**
   * 处理数据类型选择
   * @param type - 选择的数据类型
   */
  function handleSelectType(type: string): void {
    emit('selectType', props.columnId, type)
  }

  /**
   * 处理数组元素类型选择
   * @param type - 选择的元素类型
   */
  function handleSelectItemsType(type: string): void {
    emit('selectItemsType', props.columnId, type)
  }

  // ============================================================================
  // 导入
  // ============================================================================

  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
</script>

<style scoped src="./JsonSchemaNodeColumnMenuDropdown.styles.css"></style>
