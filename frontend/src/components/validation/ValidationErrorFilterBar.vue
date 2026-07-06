<script setup lang="ts">
  import { computed, ref, onMounted, onUnmounted } from 'vue'
  import { useI18n } from 'vue-i18n'

  const props = defineProps<{
    stageFilter: 'all' | 'loading' | 'format' | 'constraint'
    groupBy: 'table' | 'stage' | 'type' | 'none'
    searchQuery: string
  }>()

  const emit = defineEmits<{
    (e: 'update:stageFilter', value: 'all' | 'loading' | 'format' | 'constraint'): void
    (e: 'update:groupBy', value: 'table' | 'stage' | 'type' | 'none'): void
    (e: 'update:searchQuery', value: string): void
  }>()

  const { t } = useI18n()

  const stageOptions = [
    { key: 'all' as const, label: t('common.all') },
    { key: 'loading' as const, label: t('common.fullValidation.result.loading') },
    { key: 'format' as const, label: t('common.fullValidation.result.format') },
    { key: 'constraint' as const, label: t('common.fullValidation.result.constraint') },
  ]

  const groupOptions = [
    { key: 'table' as const, label: '按表' },
    { key: 'stage' as const, label: '按阶段' },
    { key: 'type' as const, label: '按类型' },
    { key: 'none' as const, label: '不分组' },
  ]

  const groupDropdownOpen = ref(false)
  const groupTriggerRef = ref<HTMLElement | null>(null)

  const selectedGroupLabel = computed(() => {
    return groupOptions.find((opt) => opt.key === props.groupBy)?.label ?? ''
  })

  function selectGroup(value: 'table' | 'stage' | 'type' | 'none') {
    emit('update:groupBy', value)
    groupDropdownOpen.value = false
  }

  function handleDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement
    if (!groupTriggerRef.value?.contains(target)) {
      groupDropdownOpen.value = false
    }
  }

  onMounted(() => {
    document.addEventListener('click', handleDocumentClick)
  })

  onUnmounted(() => {
    document.removeEventListener('click', handleDocumentClick)
  })
</script>

<template>
  <div class="fv-filter-bar">
    <div class="fv-filter-row">
      <div class="fv-filter-group">
        <span class="fv-filter-label">分组</span>
        <div ref="groupTriggerRef" class="fv-group-dropdown">
          <button
            type="button"
            class="fv-group-trigger"
            :class="{ 'is-open': groupDropdownOpen }"
            @click.stop="groupDropdownOpen = !groupDropdownOpen"
          >
            <span class="fv-group-trigger-label">{{ selectedGroupLabel }}</span>
            <svg
              class="fv-group-trigger-arrow"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <Transition name="fv-dropdown">
            <ul v-show="groupDropdownOpen" class="fv-group-menu" role="listbox">
              <li
                v-for="opt in groupOptions"
                :key="opt.key"
                class="fv-group-menu-item"
                :class="{ 'is-active': props.groupBy === opt.key }"
                role="option"
                :aria-selected="props.groupBy === opt.key"
                @click="selectGroup(opt.key)"
              >
                {{ opt.label }}
              </li>
            </ul>
          </Transition>
        </div>
      </div>

      <div class="fv-stage-filter">
        <span class="fv-filter-label">阶段</span>
        <div class="fv-stage-chips">
          <button
            v-for="opt in stageOptions"
            :key="opt.key"
            class="fv-stage-chip"
            :class="{ 'is-active': stageFilter === opt.key }"
            type="button"
            @click="emit('update:stageFilter', opt.key)"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>
    </div>

    <div class="fv-filter-search">
      <svg
        class="fv-search-icon"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        :value="searchQuery"
        class="ui-input ui-input--compact"
        type="text"
        placeholder="搜索错误..."
        @input="emit('update:searchQuery', ($event.target as HTMLInputElement).value)"
      />
    </div>
  </div>
</template>

<style scoped>
  .fv-group-dropdown {
    position: relative;
    display: inline-block;
    min-width: 120px;
  }

  .fv-group-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ui-space-sm);
    width: 100%;
    height: 32px;
    padding: 0 var(--ui-space-sm);
    padding-right: 36px;
    font-size: var(--ui-font-size-sm);
    font-family: var(--ui-font-family);
    color: var(--ui-text-body);
    background: var(--ui-bg-elevated);
    border: 1px solid var(--ui-border-light);
    border-radius: var(--ui-radius-sm);
    cursor: pointer;
    transition: all var(--ui-transition-fast);
    box-sizing: border-box;
  }

  .fv-group-trigger:hover {
    border-color: var(--ui-border-strong);
  }

  .fv-group-trigger:focus-visible {
    outline: none;
    border-color: var(--ui-accent);
    box-shadow: var(--ui-shadow-focus);
  }

  .fv-group-trigger-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .fv-group-trigger-arrow {
    position: absolute;
    right: 10px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--ui-text-muted);
    flex-shrink: 0;
    transition: transform var(--ui-transition-fast);
  }

  .fv-group-trigger.is-open .fv-group-trigger-arrow {
    transform: translateY(-50%) rotate(180deg);
  }

  .fv-group-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: var(--ui-z-dropdown, 100);
    min-width: 100%;
    margin: 0;
    padding: 4px;
    list-style: none;
    background: var(--ui-bg-elevated);
    border: 1px solid var(--ui-border-light);
    border-radius: var(--ui-radius-sm);
    box-shadow: var(--ui-shadow-elevation-md);
    box-sizing: border-box;
  }

  .fv-group-menu-item {
    padding: 6px 10px;
    font-size: var(--ui-font-size-sm);
    color: var(--ui-text-body);
    border-radius: calc(var(--ui-radius-sm) - 2px);
    cursor: pointer;
    transition: background var(--ui-transition-fast);
    white-space: nowrap;
  }

  .fv-group-menu-item:hover,
  .fv-group-menu-item.is-active {
    background: var(--ui-bg-subtle);
  }

  .fv-group-menu-item.is-active {
    color: var(--ui-accent-strong);
    font-weight: var(--ui-font-weight-medium);
  }

  .fv-dropdown-enter-active,
  .fv-dropdown-leave-active {
    transition:
      opacity var(--ui-transition-fast),
      transform var(--ui-transition-fast);
  }

  .fv-dropdown-enter-from,
  .fv-dropdown-leave-to {
    opacity: 0;
    transform: translateY(-4px);
  }
</style>
