<!--
  @file JsonFieldRow.vue
  @description JSON Schema 字段行的递归编辑器组件

  渲染单个字段（含嵌套 children）：字段名、数据类型、jsonPath（只读）、
  nullable/primaryKey 切换、内嵌约束（NN/UQ）切换、删除按钮。
  当字段有 children 时递归渲染自身，按 depth 缩进。

  这是 JsonSchemaNodeInspector 的专属子组件（SchemaNodeInspector 是扁平列，无需递归）。
-->
<template>
  <div class="json-field-row" :style="{ marginLeft: `${depth * 16}px` }">
    <div class="column-edit-row-header">
      <span v-if="hasChildren" class="row-toggle" :title="column.columnName">▾</span>
      <span v-else class="row-toggle-spacer"></span>
      <input
        class="column-name-input"
        :value="column.columnName"
        @change="emit('rename', column.id, ($event.target as HTMLInputElement).value)"
        :placeholder="t('inspector.jsonSchemaNode.placeholders.columnName')"
      />
      <button
        class="column-delete-btn"
        @click="emit('delete', column.id)"
        :title="t('inspector.jsonSchemaNode.actions.deleteField')"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
    <div class="column-edit-row-body">
      <!-- jsonPath 只读展示（路径由父子结构决定，不建议手改） -->
      <div class="column-edit-field">
        <label class="column-edit-label">{{ t('inspector.jsonSchemaNode.labels.jsonPath') }}</label>
        <code class="jsonpath-readonly" :title="column.jsonPath">{{ column.jsonPath }}</code>
      </div>
      <!-- 数据类型选择器 -->
      <div class="column-edit-field">
        <label class="column-edit-label">{{ t('inspector.jsonSchemaNode.labels.dataType') }}</label>
        <select
          class="column-type-select"
          :value="column.dataType"
          @change="
            emit(
              'type-change',
              column.id,
              ($event.target as HTMLSelectElement).value as JsonDataType
            )
          "
        >
          <option v-for="dt in jsonDataTypes" :key="dt" :value="dt">
            {{ getDataTypeDisplay(dt) }}
          </option>
        </select>
      </div>
      <!-- 属性与约束切换 -->
      <div class="column-edit-constraints">
        <label class="column-edit-label">{{
          t('inspector.jsonSchemaNode.labels.attributes')
        }}</label>
        <div class="constraint-toggles">
          <button
            class="constraint-toggle nullable"
            :class="{ active: column.nullable ?? true }"
            @click="emit('toggle-nullable', column.id)"
            :title="t('inspector.jsonSchemaNode.labels.nullable')"
          >
            ?
          </button>
          <button
            class="constraint-toggle primary-key"
            :class="{ active: !!column.primaryKey }"
            @click="emit('toggle-primary-key', column.id)"
            :title="t('inspector.jsonSchemaNode.labels.primaryKey')"
          >
            PK
          </button>
          <button
            class="constraint-toggle not-null"
            :class="{ active: !!column.constraints?.notNull }"
            @click="emit('toggle-constraint', column.id, 'notNull')"
            :title="t('inspector.jsonSchemaNode.constraints.notNull')"
          >
            NN
          </button>
          <button
            class="constraint-toggle unique"
            :class="{ active: !!column.constraints?.unique }"
            @click="emit('toggle-constraint', column.id, 'unique')"
            :title="t('inspector.jsonSchemaNode.constraints.unique')"
          >
            UQ
          </button>
        </div>
      </div>
    </div>

    <!-- 递归渲染子字段 -->
    <template v-if="column.children && column.children.length > 0">
      <JsonFieldRow
        v-for="(child, idx) in column.children"
        :key="child.id"
        :column="child"
        :index="idx"
        :depth="depth + 1"
        @rename="(id, name) => emit('rename', id, name)"
        @type-change="(id, type) => emit('type-change', id, type)"
        @toggle-nullable="(id) => emit('toggle-nullable', id)"
        @toggle-primary-key="(id) => emit('toggle-primary-key', id)"
        @toggle-constraint="(id, type) => emit('toggle-constraint', id, type)"
        @delete="(id) => emit('delete', id)"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
  import { useI18n } from 'vue-i18n'
  import type { JsonSchemaColumn, JsonDataType } from '@/types/nodes'

  const props = defineProps<{
    column: JsonSchemaColumn
    index: number
    depth: number
  }>()

  const emit = defineEmits<{
    rename: [columnId: string, name: string]
    'type-change': [columnId: string, type: JsonDataType]
    'toggle-nullable': [columnId: string]
    'toggle-primary-key': [columnId: string]
    'toggle-constraint': [columnId: string, type: 'notNull' | 'unique']
    delete: [columnId: string]
  }>()

  const { t } = useI18n()

  const jsonDataTypes: JsonDataType[] = ['string', 'number', 'boolean', 'object', 'array', 'null']

  const hasChildren = !!(props.column.children && props.column.children.length > 0)

  function getDataTypeDisplay(type: JsonDataType): string {
    const map: Record<string, string> = {
      string: 'String',
      number: 'Number',
      boolean: 'Boolean',
      object: 'Object',
      array: 'Array',
      null: 'Null',
    }
    return map[type] || type
  }
</script>
