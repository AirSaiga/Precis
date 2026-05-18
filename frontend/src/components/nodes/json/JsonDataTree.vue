<!--
  @file JsonDataTree.vue
  @description JSON数据树组件 - JSON数据浏览、导航与面包屑
-->

<template>
  <div class="json-data-tree">
    <!-- 面包屑导航 -->
    <div v-if="breadcrumbPath.length > 0" class="breadcrumb-bar">
      <span
        class="breadcrumb-root"
        :class="{ active: selectedPath.length === 0 }"
        @click="navigateToRoot()"
      >
        Root
      </span>
      <span v-for="(segment, index) in breadcrumbPath" :key="index" class="breadcrumb-item">
        <span class="breadcrumb-separator">/</span>
        <span
          class="breadcrumb-text"
          :class="{ active: index === breadcrumbPath.length - 1 }"
          @click="navigateToLevel(index + 1)"
        >
          {{ segment }}
        </span>
      </span>
    </div>

    <!-- 当前层级内容 -->
    <div class="tree-content" ref="treeContentRef">
      <div v-if="currentLevelData" class="level-view">
        <!-- 如果是数组 -->
        <template v-if="isArray(currentLevelData)">
          <div
            v-for="(item, index) in currentLevelData"
            :key="index"
            class="tree-row"
            :class="{ selected: isSelectedInPath(index) }"
            @click="navigateInto(item, index)"
          >
            <span class="expand-btn" v-if="isExpandable(item)">
              <svg viewBox="0 0 10 10">
                <path d="M3 2 L7 5 L3 8" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
            <span v-else class="expand-placeholder">
              <svg viewBox="0 0 10 10">
                <circle cx="5" cy="5" r="1" fill="currentColor" />
              </svg>
            </span>

            <span class="key-name">[{{ index }}]</span>

            <span class="value-text" :class="'type-' + getValueType(item)">
              <template v-if="isExpandable(item)">
                <span v-if="getValueType(item) === 'array'"
                  >[{{ (item as unknown[]).length }} items]</span
                >
                <span v-else>{{ '{...}' }}</span>
              </template>
              <template v-else>
                {{ formatValue(item) }}
              </template>
            </span>
          </div>
        </template>

        <!-- 如果是对象 -->
        <template v-else-if="isObject(currentLevelData)">
          <div
            v-for="(value, key) in currentLevelData"
            :key="key"
            class="tree-row"
            :class="{ selected: isSelectedInPath(key) }"
            @click="navigateInto(value, key)"
          >
            <span class="expand-btn" v-if="isExpandable(value)">
              <svg viewBox="0 0 10 10">
                <path d="M3 2 L7 5 L3 8" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
            <span v-else class="expand-placeholder">
              <svg viewBox="0 0 10 10">
                <circle cx="5" cy="5" r="1" fill="currentColor" />
              </svg>
            </span>

            <span class="key-name">{{ key }}</span>
            <span class="key-separator">:</span>

            <span class="value-text" :class="'type-' + getValueType(value)">
              <template v-if="isExpandable(value)">
                <span v-if="getValueType(value) === 'array'"
                  >[{{ (value as unknown[]).length }} items]</span
                >
                <span v-else>{{ '{...}' }}</span>
              </template>
              <template v-else>
                {{ formatValue(value) }}
              </template>
            </span>
          </div>
        </template>

        <!-- 基本类型 -->
        <template v-else>
          <div class="tree-row primitive-row">
            <span class="expand-placeholder">
              <svg viewBox="0 0 10 10">
                <circle cx="5" cy="5" r="1" fill="currentColor" />
              </svg>
            </span>
            <span class="value-text" :class="'type-' + getValueType(currentLevelData)">
              {{ formatValue(currentLevelData) }}
            </span>
          </div>
        </template>
      </div>
    </div>

    <!-- 返回上级按钮（当不在根层级时显示） -->
    <button
      v-if="selectedPath.length > 0"
      class="back-button"
      @click="navigateUp()"
      title="返回上级"
    >
      <svg viewBox="0 0 24 24" width="14" height="14">
        <path
          d="M19 12H5M12 19l-7-7 7-7"
          stroke="currentColor"
          stroke-width="2"
          fill="none"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      返回上级
    </button>
  </div>
</template>

<script setup lang="ts">
  import { ref, computed, watch, nextTick } from 'vue'

  const props = defineProps<{
    data: unknown
  }>()

  // 当前选中的路径（如 [0, 'warehouse_data', 'inventory', 2]）
  const selectedPath = ref<(string | number)[]>([])
  const treeContentRef = ref<HTMLElement | null>(null)

  // 监听数据变化，重置路径
  watch(
    () => props.data,
    () => {
      selectedPath.value = []
    },
    { immediate: true }
  )

  // 面包屑路径
  const breadcrumbPath = computed(() => {
    const path: string[] = []
    let current = props.data

    for (const key of selectedPath.value) {
      if (Array.isArray(current)) {
        path.push(`[${key}]`)
      } else if (typeof current === 'object' && current !== null) {
        path.push(String(key))
      }
      current = getValueAtPath(current, [key])
    }

    return path
  })

  // 当前层级的数据
  const currentLevelData = computed(() => {
    return getValueAtPath(props.data, selectedPath.value)
  })

  // 获取指定路径的值
  function getValueAtPath(data: unknown, path: (string | number)[]): unknown {
    let current = data
    for (const key of path) {
      if (Array.isArray(current)) {
        current = current[key as number]
      } else if (typeof current === 'object' && current !== null) {
        current = (current as Record<string, unknown>)[key as string]
      } else {
        return undefined
      }
    }
    return current
  }

  // 判断是否在选中路径中
  function isSelectedInPath(key: string | number): boolean {
    const fullPath = [...selectedPath.value, key]
    const nextLevel = getValueAtPath(props.data, fullPath)
    return isExpandable(nextLevel)
  }

  // 导航到指定层级
  function navigateToLevel(level: number) {
    selectedPath.value = selectedPath.value.slice(0, level)
  }

  // 导航到根
  function navigateToRoot() {
    selectedPath.value = []
  }

  // 导航进入子项
  function navigateInto(value: unknown, key: string | number) {
    if (isExpandable(value)) {
      selectedPath.value.push(key)
      // 滚动到顶部
      nextTick(() => {
        if (treeContentRef.value) {
          treeContentRef.value.scrollTop = 0
        }
      })
    }
  }

  // 返回上级
  function navigateUp() {
    if (selectedPath.value.length > 0) {
      selectedPath.value.pop()
    }
  }

  // 类型检查函数
  function isArray(value: unknown): value is unknown[] {
    return Array.isArray(value)
  }

  function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  function isExpandable(value: unknown): boolean {
    return isArray(value) || isObject(value)
  }

  function getValueType(value: unknown): string {
    if (value === null) return 'null'
    if (Array.isArray(value)) return 'array'
    return typeof value
  }

  function formatValue(value: unknown): string {
    if (value === null) return 'null'
    if (typeof value === 'string') return `"${value}"`
    return String(value)
  }
</script>

<style scoped src="./JsonDataTree.styles.css"></style>
