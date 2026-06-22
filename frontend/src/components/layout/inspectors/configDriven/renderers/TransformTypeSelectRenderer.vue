<!--
  @file TransformTypeSelectRenderer.vue
  @description Transform 类型切换下拉渲染器

  功能：
  - 点击触发器显示分类分组的下拉面板（5 分类 × N 类型）
  - 选择新类型时弹出确认（使用项目自定义 useGlobalConfirm）
  - 确认后一次性 emit __patch：transformType + 清空 params/outputColumns + saveState='draft'
  - 同类型不触发，取消不触发

  设计：不使用原生 select + optgroup（分组体验差），改为自定义浮层，
  复用 transformCategory.ts 的分类数据源。
-->
<template>
  <div class="field transform-type-select" ref="rootRef">
    <label class="label">{{ label }}</label>
    <button
      type="button"
      class="select-trigger"
      :class="{ open: showDropdown }"
      :disabled="readonly"
      @click="toggleDropdown"
    >
      <span class="trigger-icon">{{ categoryIcon }}</span>
      <span class="trigger-text">{{ typeName }}</span>
      <span class="trigger-arrow" :class="{ rotated: showDropdown }">▾</span>
    </button>

    <Teleport to="body">
      <Transition name="dropdown-fade">
        <div v-if="showDropdown" class="type-dropdown-panel" :style="panelStyle" @click.stop>
          <div class="dropdown-search">
            <input
              ref="searchInputRef"
              v-model="searchQuery"
              type="text"
              :placeholder="t('inspector.transformNode.typeSelect.searchPlaceholder')"
              @keydown.esc="closeDropdown"
            />
          </div>
          <div class="dropdown-body">
            <div v-for="cat in filteredCategories" :key="cat.id" class="dropdown-group">
              <div class="group-title">
                <span class="group-icon">{{ cat.icon }}</span>
                {{ t(cat.labelKey) }}
              </div>
              <div class="group-items">
                <button
                  v-for="type in cat.types"
                  :key="type"
                  type="button"
                  class="group-item"
                  :class="{ active: type === currentType }"
                  @click="selectType(type)"
                >
                  {{ getTypeLabel(type) }}
                </button>
              </div>
            </div>
            <div v-if="filteredCategories.length === 0" class="dropdown-empty">
              {{ t('inspector.transformNode.typeSelect.noResults') }}
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <div v-if="help" class="help">{{ help }}</div>
  </div>
</template>

<script setup lang="ts">
  import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { TransformTypeV2 } from '@/types/projectV2'
  import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
  import type { InspectorContext } from '../utils'
  import type { InspectorTransformTypeSelectField } from '../types'
  import { TRANSFORM_TYPE_I18N_KEYS } from '@/composables/nodes/transform/transformDisplay'
  import {
    TRANSFORM_CATEGORIES,
    getCategoryIcon,
  } from '@/composables/nodes/transform/transformCategory'
  const { t } = useI18n()
  const { showConfirm } = useGlobalConfirm()

  const props = defineProps<{
    field: InspectorTransformTypeSelectField
    ctx: InspectorContext
    value: unknown
    label: string
    help?: string
    placeholder?: string
    readonly: boolean
  }>()

  const emit = defineEmits<{
    commit: [value: unknown]
  }>()

  const rootRef = ref<HTMLDivElement | null>(null)
  const searchInputRef = ref<HTMLInputElement | null>(null)
  const showDropdown = ref(false)
  const searchQuery = ref('')
  const panelPosition = ref({ left: 0, top: 0, width: 0 })

  /** 当前 transformType */
  const currentType = computed<TransformTypeV2 | undefined>(() => {
    return (props.value as TransformTypeV2) ?? undefined
  })

  /** 当前类型图标 */
  const categoryIcon = computed(() =>
    currentType.value ? getCategoryIcon(currentType.value) : '⚙️'
  )

  /** 当前类型显示名 */
  const typeName = computed(() => {
    const type = currentType.value
    if (!type) return '-'
    const key = TRANSFORM_TYPE_I18N_KEYS[type]
    return key ? t(key) : type
  })

  /** 获取类型的分类显示标签 */
  function getTypeLabel(type: TransformTypeV2): string {
    const key = TRANSFORM_TYPE_I18N_KEYS[type]
    return key ? t(key) : type
  }

  /** 下拉面板定位样式 */
  const panelStyle = computed(() => ({
    left: `${panelPosition.value.left}px`,
    top: `${panelPosition.value.top}px`,
    width: `${panelPosition.value.width}px`,
  }))

  /** 搜索过滤后的分类 */
  const filteredCategories = computed(() => {
    const query = searchQuery.value.trim().toLowerCase()
    if (!query) return TRANSFORM_CATEGORIES
    return TRANSFORM_CATEGORIES.map((cat) => ({
      ...cat,
      types: cat.types.filter((type) => {
        const label = getTypeLabel(type).toLowerCase()
        return label.includes(query) || type.toLowerCase().includes(query)
      }),
    })).filter((cat) => cat.types.length > 0)
  })

  /** 计算下拉面板定位（相对触发器） */
  function updatePanelPosition() {
    const el = rootRef.value?.querySelector('.select-trigger') as HTMLElement | null
    if (!el) return
    const rect = el.getBoundingClientRect()
    const PANEL_MAX_HEIGHT = 360
    let top = rect.bottom + 4
    // 防止超出视口底部
    if (top + PANEL_MAX_HEIGHT > window.innerHeight) {
      top = Math.max(8, rect.top - PANEL_MAX_HEIGHT - 4)
    }
    panelPosition.value = {
      left: rect.left,
      top,
      width: Math.max(rect.width, 240),
    }
  }

  async function toggleDropdown() {
    if (props.readonly) return
    if (showDropdown.value) {
      closeDropdown()
      return
    }
    showDropdown.value = true
    searchQuery.value = ''
    await nextTick()
    updatePanelPosition()
    searchInputRef.value?.focus()
    document.addEventListener('click', handleOutsideClick)
    window.addEventListener('resize', updatePanelPosition)
    window.addEventListener('scroll', updatePanelPosition, true)
  }

  function closeDropdown() {
    showDropdown.value = false
    searchQuery.value = ''
    document.removeEventListener('click', handleOutsideClick)
    window.removeEventListener('resize', updatePanelPosition)
    window.removeEventListener('scroll', updatePanelPosition, true)
  }

  function handleOutsideClick(e: MouseEvent) {
    const panel = document.querySelector('.type-dropdown-panel')
    if (panel?.contains(e.target as Node)) return
    if (rootRef.value?.contains(e.target as Node)) return
    closeDropdown()
  }

  /** 选择新类型 —— 带确认 + 清空旧参数 */
  async function selectType(newType: TransformTypeV2) {
    // 同类型直接关闭
    if (newType === currentType.value) {
      closeDropdown()
      return
    }

    const newTypeName = getTypeLabel(newType)

    // 弹出确认（使用项目自定义 confirm，避免 Electron 原生 confirm 问题）
    const confirmed = await showConfirm({
      title: t('inspector.transformNode.typeChangeConfirm.title'),
      message: t('inspector.transformNode.typeChangeConfirm.message', {
        type: newTypeName,
      }),
      confirmText: t('inspector.transformNode.typeChangeConfirm.confirm'),
      cancelText: t('inspector.transformNode.typeChangeConfirm.cancel'),
      type: 'warning',
    })

    if (!confirmed) {
      // 取消则保留下拉打开状态，方便用户重选
      return
    }

    // 一次性 emit 多字段 patch，BaseInspector.commitField 的 __patch 分支会原样透传
    emit('commit', {
      __patch: {
        transformType: newType,
        params: {},
        outputColumns: [],
        saveState: 'draft',
      },
    })
    closeDropdown()
  }

  // 切换可见性时清理监听
  watch(showDropdown, (val) => {
    if (!val) {
      document.removeEventListener('click', handleOutsideClick)
      window.removeEventListener('resize', updatePanelPosition)
      window.removeEventListener('scroll', updatePanelPosition, true)
    }
  })

  onBeforeUnmount(() => {
    document.removeEventListener('click', handleOutsideClick)
    window.removeEventListener('resize', updatePanelPosition)
    window.removeEventListener('scroll', updatePanelPosition, true)
  })
</script>

<style scoped>
  /*
   * TransformTypeSelectRenderer 样式
   */
  .field {
    margin-bottom: 8px;
  }

  .label {
    display: block;
    font-size: 11px;
    color: var(--ui-text-muted, #858585);
    margin-bottom: 4px;
  }

  /* ---- 触发器按钮 ---- */
  .select-trigger {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 30px;
    padding: 0 10px;
    background: var(--ui-bg-canvas, #1e1e1e);
    border: 1px solid var(--ui-border-light, #3c3c3c);
    border-radius: 4px;
    color: var(--ui-text-primary, #ccc);
    font-size: 12px;
    cursor: pointer;
    outline: none;
    box-sizing: border-box;
    transition:
      border-color 0.15s ease,
      background 0.15s ease;
  }

  .select-trigger:hover:not(:disabled) {
    border-color: var(--ui-border, #555);
  }

  .select-trigger.open {
    border-color: var(--ui-accent, #007acc);
  }

  .select-trigger:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .trigger-icon {
    font-size: 14px;
    line-height: 1;
    flex-shrink: 0;
  }

  .trigger-text {
    flex: 1;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }

  .trigger-arrow {
    font-size: 10px;
    color: var(--ui-text-muted, #858585);
    transition: transform 0.15s ease;
    flex-shrink: 0;
  }

  .trigger-arrow.rotated {
    transform: rotate(180deg);
  }

  .help {
    font-size: 11px;
    color: var(--ui-text-muted, #858585);
    margin-top: 4px;
  }

  /* ---- 下拉面板（Teleport 到 body） ---- */
  .type-dropdown-panel {
    position: fixed;
    z-index: 10000;
    max-height: 360px;
    display: flex;
    flex-direction: column;
    background: var(--ui-bg-elevated, #2d2d30);
    border: 1px solid var(--ui-border-subtle, #333);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    overflow: hidden;
    font-size: 12px;
    color: var(--ui-text-primary, #ccc);
    user-select: none;
  }

  /* 搜索框 */
  .dropdown-search {
    padding: 8px;
    border-bottom: 1px solid var(--ui-border-subtle, #333);
  }

  .dropdown-search input {
    width: 100%;
    height: 30px;
    padding: 0 10px;
    background: var(--ui-bg-canvas, #1e1e1e);
    border: 1px solid var(--ui-border-light, #3c3c3c);
    border-radius: 4px;
    color: var(--ui-text-primary, #ccc);
    font-size: 12px;
    outline: none;
    box-sizing: border-box;
  }

  .dropdown-search input::placeholder {
    color: var(--ui-text-muted, #858585);
  }

  .dropdown-search input:focus {
    border-color: var(--ui-accent, #007acc);
  }

  /* 主体滚动区 */
  .dropdown-body {
    flex: 1;
    overflow-y: auto;
    padding: 6px;
  }

  .dropdown-body::-webkit-scrollbar {
    width: 6px;
  }

  .dropdown-body::-webkit-scrollbar-track {
    background: transparent;
  }

  .dropdown-body::-webkit-scrollbar-thumb {
    background: var(--ui-border-light, #3c3c3c);
    border-radius: 3px;
  }

  /* 分类分组 */
  .dropdown-group {
    margin-bottom: 6px;
  }

  .group-title {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px 4px;
    font-size: 11px;
    font-weight: 600;
    color: var(--ui-text-muted, #858585);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }

  .group-icon {
    font-size: 12px;
    line-height: 1;
  }

  .group-items {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 3px;
    padding: 0 4px;
  }

  .group-item {
    padding: 6px 8px;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--ui-text-primary, #ccc);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: background 0.12s ease;
  }

  .group-item:hover {
    background: var(--ui-accent-primary, #0e639c);
  }

  .group-item.active {
    background: var(--ui-bg-muted, #3a3a3f);
    color: var(--ui-text-strong, #fff);
    font-weight: 600;
  }

  /* 空状态 */
  .dropdown-empty {
    padding: 20px;
    text-align: center;
    color: var(--ui-text-muted, #858585);
    font-size: 12px;
  }

  /* 过渡动画 */
  .dropdown-fade-enter-active,
  .dropdown-fade-leave-active {
    transition:
      opacity 0.15s ease,
      transform 0.15s ease;
  }

  .dropdown-fade-enter-from,
  .dropdown-fade-leave-to {
    opacity: 0;
    transform: translateY(-4px);
  }
</style>
