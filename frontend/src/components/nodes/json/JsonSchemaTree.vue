<!--
  @file JsonSchemaTree.vue
  @description JSON结构树组件 - JSON Schema结构展示与展开
-->

<template>
  <div class="tree-body">
    <div
      v-for="item in visibleItems"
      :key="item.id"
      class="tree-row"
      :style="{ paddingLeft: 8 + item.level * 16 + 'px' }"
    >
      <!-- 展开按钮 -->
      <span
        v-if="item.canHaveChildren"
        class="expand-btn"
        :class="{ 'is-empty': !item.hasChildren }"
        @click="toggle(item.id)"
      >
        <svg
          viewBox="0 0 10 10"
          :style="{ transform: item.isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }"
        >
          <path d="M3 2 L7 5 L3 8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>
      <span v-else class="expand-placeholder">
        <svg viewBox="0 0 10 10">
          <circle cx="5" cy="5" r="1" fill="currentColor" />
        </svg>
      </span>

      <!-- 类型标签 - 胶囊样式 (支持点击展开下拉框) -->
      <div class="type-selector-wrapper">
        <span
          class="type-tag"
          :class="'type-' + item.type"
          @click="toggleTypeDropdown(item.id, $event)"
        >
          {{ item.type }}
          <span class="dropdown-arrow">▼</span>
        </span>
      </div>

      <!-- 名称 (可编辑) -->
      <input
        v-if="editingId === item.id"
        v-model="editingName"
        class="field-input"
        @blur="saveName(item.id)"
        @keydown.enter="saveName(item.id)"
        @keydown.esc="cancelEdit()"
      />
      <span v-else class="field-name" @dblclick="startEdit(item)">{{ item.name }}</span>

      <!-- 路径 -->
      <span class="field-path" :title="item.path">{{ item.path }}</span>

      <!-- 操作 -->
      <span class="actions">
        <button v-if="item.canHaveChildren" class="btn-icon btn-add" @click="addChild(item.id)">
          +
        </button>
        <button class="btn-icon btn-del" @click="remove(item.id)">×</button>
      </span>

      <!-- 连接点 -->
      <Handle
        :id="'source-right-' + item.id"
        type="source"
        :position="Position.Right"
        class="column-handle"
      />
    </div>

    <!-- 传送门挂载的类型选择下拉框 -->
    <Teleport to="body">
      <div
        v-if="activeTypeDropdown"
        class="type-dropdown-menu"
        :style="{ top: dropdownPosition.top + 'px', left: dropdownPosition.left + 'px' }"
        @click.stop
      >
        <div
          v-for="opt in typeOptions"
          :key="opt"
          class="type-option"
          :class="'type-' + opt"
          @click="selectType(activeTypeDropdown, opt)"
        >
          {{ opt }}
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
  import { computed, ref, onMounted, onUnmounted } from 'vue'
  import { Handle, Position } from '@vue-flow/core'
  import type { JsonSchemaColumn, JsonDataType } from '@/types/graph'

  const props = defineProps<{
    columns: JsonSchemaColumn[]
  }>()

  const emit = defineEmits<{
    update: [columns: JsonSchemaColumn[]]
  }>()

  const editingId = ref<string | null>(null)
  const editingName = ref('')

  // 类型下拉框状态
  const activeTypeDropdown = ref<string | null>(null)
  const dropdownPosition = ref({ top: 0, left: 0 })
  const typeOptions: JsonDataType[] = ['string', 'number', 'boolean', 'object', 'array', 'null']

  const visibleItems = computed(() => {
    const items: Array<{
      id: string
      name: string
      path: string
      type: string
      level: number
      hasChildren: boolean
      isExpanded: boolean
      canHaveChildren: boolean
    }> = []

    const walk = (cols: JsonSchemaColumn[], level: number) => {
      for (const col of cols) {
        const hasChildren = col.children && col.children.length > 0
        items.push({
          id: col.id,
          name: col.columnName,
          path: col.jsonPath,
          type: col.dataType,
          level,
          hasChildren,
          isExpanded: col.isExpanded ?? false,
          canHaveChildren: col.dataType === 'object' || col.dataType === 'array',
        })

        if (col.isExpanded && hasChildren) {
          walk(col.children!, level + 1)
        }
      }
    }

    if (props.columns) {
      walk(props.columns, 0)
    }

    return items
  })

  const updateColumn = (
    cols: JsonSchemaColumn[],
    id: string,
    updater: (c: JsonSchemaColumn) => JsonSchemaColumn
  ): JsonSchemaColumn[] => {
    return cols.map((c) => {
      if (c.id === id) {
        return updater({ ...c })
      }
      if (c.children) {
        return { ...c, children: updateColumn(c.children, id, updater) }
      }
      return c
    })
  }

  const toggle = (id: string) => {
    const cols = updateColumn(props.columns, id, (c) => ({
      ...c,
      isExpanded: !c.isExpanded,
    }))
    emit('update', cols)
  }

  const startEdit = (item: { id: string; name: string }) => {
    editingId.value = item.id
    editingName.value = item.name
  }

  const saveName = (id: string) => {
    const newName = editingName.value.trim()
    if (newName) {
      const cols = updateColumn(props.columns, id, (c) => {
        const oldPath = c.jsonPath
        const lastDot = oldPath.lastIndexOf('.')
        const newPath = lastDot > 0 ? oldPath.substring(0, lastDot) + '.' + newName : '$.' + newName
        return { ...c, columnName: newName, jsonPath: newPath }
      })
      emit('update', cols)
    }
    editingId.value = null
  }

  const cancelEdit = () => {
    editingId.value = null
  }

  const remove = (id: string) => {
    const del = (cols: JsonSchemaColumn[]): JsonSchemaColumn[] =>
      cols
        .filter((c) => c.id !== id)
        .map((c) => ({
          ...c,
          children: c.children ? del(c.children) : undefined,
        }))
    emit('update', del(props.columns))
  }

  const addChild = (parentId: string) => {
    const add = (cols: JsonSchemaColumn[]): JsonSchemaColumn[] =>
      cols.map((c) => {
        if (c.id === parentId) {
          const children = c.children || []
          return {
            ...c,
            isExpanded: true,
            children: [
              ...children,
              {
                id: crypto.randomUUID(),
                columnName: `field_${children.length + 1}`,
                jsonPath: `${c.jsonPath}.field_${children.length + 1}`,
                dataType: 'string',
                nullable: true,
              },
            ],
          }
        }
        if (c.children) {
          return { ...c, children: add(c.children) }
        }
        return c
      })
    emit('update', add(props.columns))
  }

  // === 下拉框逻辑 ===
  const toggleTypeDropdown = (id: string, event: MouseEvent) => {
    event.stopPropagation()
    if (activeTypeDropdown.value === id) {
      activeTypeDropdown.value = null
      return
    }

    const target = event.currentTarget as HTMLElement
    if (!target) return

    const rect = target.getBoundingClientRect()

    dropdownPosition.value = {
      top: rect.bottom + 4,
      left: rect.left,
    }

    activeTypeDropdown.value = id
  }

  const selectType = (id: string, newType: JsonDataType) => {
    const cols = updateColumn(props.columns, id, (c) => ({
      ...c,
      dataType: newType,
    }))
    emit('update', cols)
    activeTypeDropdown.value = null
  }

  const closeDropdowns = () => {
    activeTypeDropdown.value = null
  }

  onMounted(() => {
    document.addEventListener('click', closeDropdowns)
  })

  onUnmounted(() => {
    document.removeEventListener('click', closeDropdowns)
  })
</script>

<style scoped src="./JsonSchemaTree.styles.css"></style>
