<!--
  @file TransformContextMenu.vue
  @description 画布右键节点快捷菜单（Transform + Constraint）

  功能概述:
  - 在画布空白处右键唤起，显示分类的 Transform 和 Constraint 节点列表
  - 支持搜索过滤、最近使用置顶
  - 点击后直接在鼠标位置创建对应类型的节点

  架构设计:
  - 独立 Vue 组件，通过 Teleport 挂载到 body，避免 z-index 和定位问题
  - 接收鼠标坐标和画布坐标转换后的位置，用于创建节点
  - 最近使用数据持久化到 localStorage，混合记录 Transform 和 Constraint
-->

<template>
  <Teleport to="body">
    <Transition name="menu-fade">
      <div
        v-if="visible"
        ref="menuRef"
        class="transform-context-menu"
        :style="positionStyle"
        @click.stop
      >
        <!-- 搜索框 -->
        <div class="menu-search">
          <input
            ref="searchInputRef"
            v-model="searchQuery"
            type="text"
            :placeholder="t('messages.canvas.transformMenu.searchPlaceholder')"
            @keydown.esc="close"
            @keydown.enter="selectFirstMatch"
          />
        </div>

        <!-- 最近使用 -->
        <div v-if="!searchQuery && recentItems.length > 0" class="menu-section">
          <div class="section-title">
            <span class="section-icon"><AppIcon name="clock" :size="12" /></span>
            {{ t('messages.canvas.transformMenu.recentUsed') }}
          </div>
          <div class="menu-grid">
            <div
              v-for="item in recentItems"
              :key="`${item.kind}-${item.type}`"
              class="menu-item"
              @click="selectType(item.kind, item.type)"
            >
              <span class="item-label">{{ getItemLabel(item.kind, item.type) }}</span>
            </div>
          </div>
        </div>

        <!-- Transform 分类 -->
        <div class="menu-body">
          <div
            v-for="category in filteredTransformCategories"
            :key="`tf-${category.id}`"
            class="menu-section"
          >
            <div class="section-title">
              <span class="section-icon"><AppIcon :name="category.icon" :size="12" /></span>
              {{ t(`messages.canvas.transformMenu.categories.${category.id}`) }}
            </div>
            <div class="menu-grid">
              <div
                v-for="type in category.types"
                :key="type"
                class="menu-item"
                :class="{ active: hoveredKey === `tf-${type}` }"
                @mouseenter="hoveredKey = `tf-${type}`"
                @mouseleave="hoveredKey = null"
                @click="selectType('transform', type)"
              >
                <span class="item-label">{{ getItemLabel('transform', type) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Constraint 分类 -->
        <div class="menu-body">
          <div
            v-for="category in filteredConstraintCategories"
            :key="`ct-${category.id}`"
            class="menu-section"
          >
            <div class="section-title">
              <span class="section-icon"><AppIcon :name="category.icon" :size="12" /></span>
              {{ t(`messages.canvas.transformMenu.constraintCategories.${category.id}`) }}
            </div>
            <div class="menu-grid">
              <div
                v-for="type in category.types"
                :key="type"
                class="menu-item"
                :class="{ active: hoveredKey === `ct-${type}` }"
                @mouseenter="hoveredKey = `ct-${type}`"
                @mouseleave="hoveredKey = null"
                @click="selectType('constraint', type)"
              >
                <span class="item-label">{{ getItemLabel('constraint', type) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 空状态 -->
        <div
          v-if="
            searchQuery &&
            filteredTransformCategories.length === 0 &&
            filteredConstraintCategories.length === 0
          "
          class="menu-empty"
        >
          {{ t('messages.canvas.transformMenu.noResults') }}
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
  /**
   * @file TransformContextMenu.vue
   * @description 画布右键节点快捷菜单
   *
   * 输入:
   *   - visible: 是否显示菜单
   *   - position: 菜单在屏幕上的坐标 { x, y }
   *   - flowPosition: 画布上的对应坐标 { x, y }（用于创建节点）
   *
   * 输出:
   *   - select: 用户选中的节点类型（kind + type + position）
   *   - close: 关闭菜单事件
   */

  import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
  import { useI18n } from 'vue-i18n'
  import AppIcon from '@/components/icons/AppIcon.vue'
  import { TRANSFORM_CATEGORIES as SHARED_TRANSFORM_CATEGORIES } from '@/composables/nodes/transform/transformCategory'
  // ============================================================================
  // Props & Emits
  // ============================================================================

  interface Props {
    visible: boolean
    position: { x: number; y: number }
    flowPosition: { x: number; y: number }
  }

  const props = defineProps<Props>()

  const emit = defineEmits<{
    (
      e: 'select',
      kind: 'transform' | 'constraint',
      type: string,
      position: { x: number; y: number }
    ): void
    (e: 'close'): void
  }>()

  // ============================================================================
  // i18n & 状态
  // ============================================================================

  const { t } = useI18n()

  const menuRef = ref<HTMLDivElement | null>(null)
  const searchInputRef = ref<HTMLInputElement | null>(null)
  const searchQuery = ref('')
  const hoveredKey = ref<string | null>(null)

  /** 最近使用的节点类型（混合 Transform + Constraint） */
  const recentItems = ref<RecentItem[]>(loadRecentItems())

  // ============================================================================
  // 统一分类数据结构
  // ============================================================================

  interface RecentItem {
    kind: 'transform' | 'constraint'
    type: string
  }

  interface MenuCategory {
    id: string
    icon: string
    types: string[]
    kind: 'transform' | 'constraint'
  }

  // Transform 分类 —— 复用 transformCategory.ts 单一数据源
  const TRANSFORM_CATEGORIES: MenuCategory[] = SHARED_TRANSFORM_CATEGORIES.map((cat) => ({
    id: cat.id,
    icon: cat.icon,
    kind: 'transform',
    types: cat.types,
  }))

  // Constraint 分类
  const CONSTRAINT_CATEGORIES: MenuCategory[] = [
    {
      id: 'attribute',
      icon: 'clipboard',
      kind: 'constraint',
      types: ['notNull', 'unique', 'range', 'charset'],
    },
    {
      id: 'relation',
      icon: 'link',
      kind: 'constraint',
      types: ['allowedValues', 'foreignKey'],
    },
    {
      id: 'logic',
      icon: 'brain',
      kind: 'constraint',
      types: ['conditional', 'scripted', 'dateLogic', 'composite'],
    },
  ]

  const ALL_CATEGORIES = [...TRANSFORM_CATEGORIES, ...CONSTRAINT_CATEGORIES]

  // ============================================================================
  // 计算属性
  // ============================================================================

  /** 菜单定位样式（带边界检查，防止超出视口） */
  const MENU_WIDTH = 320
  const MENU_MAX_HEIGHT = 480

  const positionStyle = computed(() => {
    let x = props.position.x
    let y = props.position.y

    if (typeof window !== 'undefined') {
      if (x + MENU_WIDTH > window.innerWidth) {
        x = window.innerWidth - MENU_WIDTH - 8
      }
      if (y + MENU_MAX_HEIGHT > window.innerHeight) {
        y = window.innerHeight - MENU_MAX_HEIGHT - 8
      }
      x = Math.max(8, x)
      y = Math.max(8, y)
    }

    return {
      left: `${x}px`,
      top: `${y}px`,
    }
  })

  /** 搜索过滤辅助函数 */
  function filterCategories(categories: MenuCategory[], query: string): MenuCategory[] {
    if (!query) return categories
    return categories
      .map((cat) => ({
        ...cat,
        types: cat.types.filter((type) => {
          const label = getItemLabel(cat.kind, type).toLowerCase()
          return label.includes(query) || type.toLowerCase().includes(query)
        }),
      }))
      .filter((cat) => cat.types.length > 0)
  }

  /** 过滤后的 Transform 分类 */
  const filteredTransformCategories = computed(() =>
    filterCategories(TRANSFORM_CATEGORIES, searchQuery.value.trim().toLowerCase())
  )

  /** 过滤后的 Constraint 分类 */
  const filteredConstraintCategories = computed(() =>
    filterCategories(CONSTRAINT_CATEGORIES, searchQuery.value.trim().toLowerCase())
  )

  /** 所有过滤后的类型（用于回车选中第一个） */
  const allFilteredItems = computed(() => [
    ...filteredTransformCategories.value.flatMap((c) =>
      c.types.map((t) => ({ kind: c.kind as 'transform', type: t }))
    ),
    ...filteredConstraintCategories.value.flatMap((c) =>
      c.types.map((t) => ({ kind: c.kind as 'constraint', type: t }))
    ),
  ])

  // ============================================================================
  // 方法
  // ============================================================================

  /** Constraint 类型到 i18n key 的映射 */
  const CONSTRAINT_NAME_MAP: Record<string, string> = {
    notNull: 'customNodes.constraintRules.notNullConstraintNode.title',
    unique: 'customNodes.constraintRules.uniqueConstraintNode.title',
    range: 'customNodes.constraintRules.rangeConstraintNode.title',
    charset: 'customNodes.constraintRules.charsetConstraintNode.title',
    allowedValues: 'customNodes.constraintRules.allowedValuesConstraintNode.title',
    foreignKey: 'customNodes.constraintRules.foreignKeyConstraintNode.title',
    conditional: 'customNodes.constraintRules.conditionalConstraintNode.title',
    scripted: 'customNodes.constraintRules.scriptedConstraintNode.title',
    dateLogic: 'customNodes.constraintRules.dateLogicConstraintNode.title',
    composite: 'customNodes.constraintRules.compositeConstraintNode.title',
  }

  /**
   * 将节点类型转换为展示用的标签
   */
  function getItemLabel(kind: 'transform' | 'constraint', type: string): string {
    if (kind === 'transform') {
      const key = type.charAt(0).toLowerCase() + type.slice(1)
      return t(`customNodes.transformNode.types.${key}`)
    }
    const key = CONSTRAINT_NAME_MAP[type]
    return key ? t(key) : type
  }

  /** 用户选中某个节点类型 */
  function selectType(kind: 'transform' | 'constraint', type: string) {
    addRecentItem({ kind, type })
    emit('select', kind, type, props.flowPosition)
    close()
  }

  /** 回车时选中搜索到的第一个结果 */
  function selectFirstMatch() {
    const first = allFilteredItems.value[0]
    if (first) {
      selectType(first.kind, first.type)
    }
  }

  /** 关闭菜单 */
  function close() {
    searchQuery.value = ''
    hoveredKey.value = null
    emit('close')
  }

  /** 点击外部关闭 */
  function handleDocumentClick(e: MouseEvent) {
    if (menuRef.value && !menuRef.value.contains(e.target as Node)) {
      close()
    }
  }

  /** 按 ESC 关闭 */
  function handleDocumentKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      close()
    }
  }

  // ============================================================================
  // 最近使用 localStorage 管理
  // ============================================================================

  const RECENT_STORAGE_KEY = 'precis:recent-nodes'
  const RECENT_MAX_COUNT = 8

  function loadRecentItems(): RecentItem[] {
    try {
      const raw = localStorage.getItem(RECENT_STORAGE_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw) as RecentItem[]
      // 只保留当前版本中仍然有效的类型
      return parsed.filter((item) => {
        const cat = ALL_CATEGORIES.find((c) => c.kind === item.kind && c.types.includes(item.type))
        return !!cat
      })
    } catch {
      return []
    }
  }

  function addRecentItem(item: RecentItem) {
    recentItems.value = [
      item,
      ...recentItems.value.filter((r) => !(r.kind === item.kind && r.type === item.type)),
    ].slice(0, RECENT_MAX_COUNT)
    try {
      localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(recentItems.value))
    } catch {
      // localStorage 可能不可用，静默失败
    }
  }

  // ============================================================================
  // 生命周期 & 监听
  // ============================================================================

  watch(
    () => props.visible,
    (val) => {
      if (val) {
        nextTick(() => {
          searchInputRef.value?.focus()
        })
        document.addEventListener('click', handleDocumentClick)
        document.addEventListener('keydown', handleDocumentKeydown)
      } else {
        document.removeEventListener('click', handleDocumentClick)
        document.removeEventListener('keydown', handleDocumentKeydown)
      }
    }
  )

  onBeforeUnmount(() => {
    document.removeEventListener('click', handleDocumentClick)
    document.removeEventListener('keydown', handleDocumentKeydown)
  })
</script>

<style scoped>
  /* ==========================================================================
   菜单容器
   ========================================================================== */
  .transform-context-menu {
    position: fixed;
    z-index: 10000;
    width: 320px;
    max-height: 480px;
    overflow-y: auto;
    background: var(--ui-bg-elevated, #2d2d30);
    border: 1px solid var(--ui-border-subtle, #333);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    padding: 8px;
    font-size: 13px;
    color: var(--ui-text-primary, #cccccc);
    user-select: none;
  }

  /* 自定义滚动条 */
  .transform-context-menu::-webkit-scrollbar {
    width: 6px;
  }
  .transform-context-menu::-webkit-scrollbar-track {
    background: transparent;
  }
  .transform-context-menu::-webkit-scrollbar-thumb {
    background: var(--ui-border-light, #3c3c3c);
    border-radius: 3px;
  }

  /* ==========================================================================
   搜索框
   ========================================================================== */
  .menu-search {
    padding: 4px 4px 8px;
    border-bottom: 1px solid var(--ui-border-subtle, #333);
    margin-bottom: 4px;
  }

  .menu-search input {
    width: 100%;
    height: 32px;
    padding: 0 10px;
    background: var(--ui-bg-canvas, #1e1e1e);
    border: 1px solid var(--ui-border-light, #3c3c3c);
    border-radius: 4px;
    color: var(--ui-text-primary, #cccccc);
    font-size: 13px;
    outline: none;
    box-sizing: border-box;
  }

  .menu-search input::placeholder {
    color: var(--ui-text-muted, #858585);
  }

  .menu-search input:focus {
    border-color: var(--ui-accent, #007acc);
  }

  /* ==========================================================================
   分类区块
   ========================================================================== */
  .menu-section {
    margin-bottom: 8px;
  }

  .section-title {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    font-size: 12px;
    font-weight: 600;
    color: var(--ui-text-muted, #858585);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .section-icon {
    font-size: 13px;
    line-height: 1;
  }

  /* ==========================================================================
   网格项目
   ========================================================================== */
  .menu-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 4px;
    padding: 0 4px;
  }

  .menu-item {
    display: flex;
    align-items: center;
    padding: 7px 8px;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.15s ease;
    overflow: hidden;
  }

  .menu-item:hover,
  .menu-item.active {
    background: var(--ui-accent-primary, #0e639c);
  }

  .item-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ==========================================================================
   空状态
   ========================================================================== */
  .menu-empty {
    padding: 20px;
    text-align: center;
    color: var(--ui-text-muted, #858585);
    font-size: 13px;
  }

  /* ==========================================================================
   过渡动画
   ========================================================================== */
  .menu-fade-enter-active,
  .menu-fade-leave-active {
    transition:
      opacity 0.15s ease,
      transform 0.15s ease;
  }

  .menu-fade-enter-from,
  .menu-fade-leave-to {
    opacity: 0;
    transform: scale(0.96);
  }
</style>
