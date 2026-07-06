<!--
  @file SchemaNodeColumnMenuDropdown.vue
  @description Schema 列下拉菜单（类型选择、约束切换、删除等）

  功能概述：
  - 统一处理列相关的下拉菜单展示
  - 约束菜单：设置非空、唯一约束
  - 类型菜单：选择数据类型（String、Int、Float、Date、Expr）

  Props：
  - show: boolean — 是否显示下拉菜单
  - menuType: 'constraint' | 'type' — 菜单类型
  - position: { top: number; left: number } — 菜单位置
  - columnId: string — 当前列 ID
  - constraints: ColumnConstraints — 当前列的约束配置
  - currentType: DataType — 当前列的数据类型
  - typeOptions: TypeOption[] — 类型选项列表

  Emits：
  - close: 关闭菜单
  - toggleConstraint: 切换约束状态
  - removeAllConstraints: 移除所有约束
  - selectType: 选择数据类型
-->
<template>
  <Teleport to="body">
    <template v-if="props.show">
      <div class="dropdown-backdrop" @click="emit('close')"></div>

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
          {{ t('customNodes.schemaNode.constraints.title') }}
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
            t('customNodes.schemaNode.constraints.notNull')
          }}</span>
          <span v-if="constraints?.notNull" class="check-icon"
            ><AppIcon name="check" :size="14"
          /></span>
        </div>

        <div
          class="constraint-menu-item"
          :class="{ active: constraints?.unique, disabled: constraints?.unique }"
          @click="handleToggle('unique')"
        >
          <span class="constraint-icon unique-icon">
            <i class="fa-solid fa-fingerprint"></i>
          </span>
          <span class="constraint-label">{{ t('customNodes.schemaNode.constraints.unique') }}</span>
          <span v-if="constraints?.unique" class="check-icon"
            ><AppIcon name="check" :size="14"
          /></span>
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
            t('customNodes.schemaNode.constraints.removeAll')
          }}</span>
        </div>
      </div>

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
    </template>
  </Teleport>
</template>

<script setup lang="ts">
  /**
   * @file SchemaNodeColumnMenuDropdown.vue
   * @description Schema节点列菜单下拉组件
   *
   * 该组件统一处理列相关的下拉菜单：
   * 1. 约束菜单：设置非空、唯一约束
   * 2. 类型菜单：选择数据类型
   */

  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import AppIcon from '@/components/icons/AppIcon.vue'
  import type { DataType } from '@/types/graph'

  /**
   * 菜单类型
   */
  type MenuType = 'constraint' | 'type'

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
    value: DataType
    label: string
  }

  /**
   * 组件属性
   */
  const props = defineProps<{
    show: boolean
    menuType: MenuType
    position: { top: number; left: number }
    columnId: string
    constraints?: ColumnConstraints
    currentType?: DataType
    typeOptions?: TypeOption[]
  }>()

  /**
   * 组件事件
   */
  const emit = defineEmits<{
    (e: 'close'): void
    (e: 'toggleConstraint', columnId: string, constraintType: 'notNull' | 'unique'): void
    (e: 'removeAllConstraints', columnId: string): void
    (e: 'selectType', columnId: string, type: DataType): void
  }>()

  const { t } = useI18n()

  const defaultTypeOptions: TypeOption[] = [
    { value: 'String', label: 'String' },
    { value: 'Integer', label: 'Int' },
    { value: 'Float', label: 'Float' },
    { value: 'Date', label: 'Date' },
    { value: 'Expression', label: 'Expr' },
  ]

  /**
   * 类型下拉选项
   * - 父组件未传入时，使用默认选项，避免菜单空白导致“看起来没展开”
   */
  const resolvedTypeOptions = computed<TypeOption[]>(() => {
    if (props.typeOptions && props.typeOptions.length > 0) return props.typeOptions
    return defaultTypeOptions
  })

  function handleToggle(constraintType: 'notNull' | 'unique'): void {
    if (props.constraints?.[constraintType]) return
    emit('toggleConstraint', props.columnId, constraintType)
  }

  function handleRemoveAll(): void {
    emit('removeAllConstraints', props.columnId)
  }

  function handleSelectType(type: DataType): void {
    emit('selectType', props.columnId, type)
  }
</script>

<style scoped src="./SchemaNodeColumnMenuDropdown.styles.css"></style>
