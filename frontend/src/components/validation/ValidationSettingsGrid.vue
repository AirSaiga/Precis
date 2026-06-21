<script setup lang="ts">
  import { ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { ValidationSettings } from '@/stores/settingsStore'

  defineProps<{
    settings: ValidationSettings
    saveBeforeRun: boolean
    missingStrategy: 'ask' | 'merge_then_run' | 'run_directly'
    hasOverrides: boolean
  }>()

  const emit = defineEmits<{
    (e: 'update:settings', settings: ValidationSettings): void
    (e: 'update:saveBeforeRun', value: boolean): void
    (e: 'update:missingStrategy', value: 'ask' | 'merge_then_run' | 'run_directly'): void
    (e: 'reset'): void
  }>()

  const { t } = useI18n()
  const isExpanded = ref(false)
</script>

<template>
  <div class="settings-section">
    <div class="settings-header">
      <span class="settings-label">{{ t('common.fullValidation.task.overrides.title') }}</span>
      <button v-if="hasOverrides" class="settings-reset-link" type="button" @click="emit('reset')">
        {{ t('common.fullValidation.task.resetOverrides') }}
      </button>
      <button class="settings-toggle" type="button" @click="isExpanded = !isExpanded">
        {{ isExpanded ? t('common.collapse') : t('common.expand') }}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          :style="{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
    </div>

    <div v-show="isExpanded" class="settings-body">
      <div class="settings-rows">
        <!-- 严格模式 -->
        <div class="setting-row">
          <span class="setting-name">{{ t('settings.project.strictMode.label') }}</span>
          <label class="ui-switch">
            <input
              :checked="settings.strict_mode"
              class="ui-switch__input"
              type="checkbox"
              @change="
                emit('update:settings', {
                  ...settings,
                  strict_mode: ($event.target as HTMLInputElement).checked,
                })
              "
            />
            <span class="ui-switch__track"></span>
          </label>
        </div>

        <!-- 错误处理 -->
        <div class="setting-row">
          <span class="setting-name">{{ t('settings.project.errorHandling.label') }}</span>
          <div class="select-wrapper">
            <select
              :value="settings.error_handling"
              class="ui-select ui-select--compact ui-select--wrapped"
              @change="
                emit('update:settings', {
                  ...settings,
                  error_handling: ($event.target as HTMLSelectElement).value as
                    | 'stop'
                    | 'continue'
                    | 'report',
                })
              "
            >
              <option value="stop">{{ t('settings.project.errorHandling.stop') }}</option>
              <option value="continue">{{ t('settings.project.errorHandling.continue') }}</option>
              <option value="report">{{ t('settings.project.errorHandling.report') }}</option>
            </select>
            <svg
              class="select-arrow"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        </div>

        <!-- 超时 -->
        <div class="setting-row">
          <span class="setting-name">{{ t('settings.project.timeout.label') }}</span>
          <div class="setting-input-with-unit">
            <input
              :value="settings.timeout_seconds"
              class="ui-input ui-input--compact"
              type="number"
              min="1"
              max="300"
              @input="
                emit('update:settings', {
                  ...settings,
                  timeout_seconds: Number(($event.target as HTMLInputElement).value),
                })
              "
            />
            <span class="setting-unit">秒</span>
          </div>
        </div>

        <!-- 批量限制 -->
        <div class="setting-row">
          <span class="setting-name">{{ t('settings.project.batchLimit.label') }}</span>
          <div class="setting-input-with-unit">
            <input
              :value="settings.batch_max_files"
              class="ui-input ui-input--compact"
              type="number"
              min="1"
              max="1000"
              @input="
                emit('update:settings', {
                  ...settings,
                  batch_max_files: Number(($event.target as HTMLInputElement).value),
                })
              "
            />
            <span class="setting-unit">文件</span>
          </div>
        </div>

        <!-- 保存项目 -->
        <div class="setting-row">
          <span class="setting-name">{{
            t('common.fullValidation.task.options.saveBeforeRun')
          }}</span>
          <label class="ui-switch">
            <input
              :checked="saveBeforeRun"
              class="ui-switch__input"
              type="checkbox"
              @change="emit('update:saveBeforeRun', ($event.target as HTMLInputElement).checked)"
            />
            <span class="ui-switch__track"></span>
          </label>
        </div>

        <!-- 未合并资源 -->
        <div class="setting-row">
          <span class="setting-name">{{
            t('common.fullValidation.task.options.missingResources')
          }}</span>
          <div class="select-wrapper">
            <select
              :value="missingStrategy"
              class="ui-select ui-select--compact ui-select--wrapped"
              @change="
                emit(
                  'update:missingStrategy',
                  ($event.target as HTMLSelectElement).value as
                    | 'ask'
                    | 'merge_then_run'
                    | 'run_directly'
                )
              "
            >
              <option value="ask">{{ t('common.fullValidation.task.options.ask') }}</option>
              <option value="merge_then_run">
                {{ t('common.fullValidation.task.options.mergeThenRun') }}
              </option>
              <option value="run_directly">
                {{ t('common.fullValidation.task.options.runDirectly') }}
              </option>
            </select>
            <svg
              class="select-arrow"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
  .settings-section {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-sm);
  }

  .settings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ui-space-sm);
  }

  .settings-label {
    font-size: var(--ui-font-size-xs);
    font-weight: var(--ui-font-weight-semibold);
    color: var(--ui-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .settings-reset-link {
    margin-left: auto;
    margin-right: var(--ui-space-sm);
    padding: 0;
    border: none;
    background: none;
    color: var(--ui-text-muted);
    font-size: var(--ui-font-size-xs);
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
    transition: color 0.15s ease;
  }

  .settings-reset-link:hover {
    color: var(--ui-text-body);
  }

  .settings-toggle {
    display: flex;
    align-items: center;
    gap: var(--ui-space-xs);
    padding: var(--ui-space-xs) var(--ui-space-sm);
    border: 1px solid var(--ui-border-light);
    border-radius: var(--ui-radius-md);
    background: var(--ui-bg-panel);
    color: var(--ui-text-muted);
    font-size: var(--ui-font-size-xs);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .settings-toggle:hover {
    background: var(--ui-bg-subtle);
    color: var(--ui-text-body);
    border-color: var(--ui-border);
  }

  .settings-body {
    padding: var(--ui-space-sm) 0;
  }

  .settings-rows {
    display: flex;
    flex-direction: column;
    gap: 0;
    border: 1px solid var(--ui-border-light);
    border-radius: var(--ui-radius-md);
    overflow: hidden;
  }

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ui-space-md);
    padding: var(--ui-space-sm) var(--ui-space-md);
    background: var(--ui-bg-panel);
    transition: background 0.15s ease;
  }

  .setting-row:hover {
    background: var(--ui-bg-subtle);
  }

  .setting-row:not(:last-child) {
    border-bottom: 1px solid var(--ui-border-light);
  }

  .setting-name {
    font-size: var(--ui-font-size-sm);
    color: var(--ui-text-body);
    font-weight: var(--ui-font-weight-medium);
  }

  .setting-input-with-unit {
    display: flex;
    align-items: center;
    gap: var(--ui-space-xs);
  }

  .setting-unit {
    font-size: var(--ui-font-size-xs);
    color: var(--ui-text-muted);
  }

  .setting-row .ui-select.ui-select--compact {
    min-width: 140px;
    width: auto;
    flex-shrink: 0;
  }

  .select-wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }

  .select-wrapper .ui-select--wrapped {
    padding-right: 36px;
    background-image: none;
  }

  .select-arrow {
    position: absolute;
    right: 10px;
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
    color: var(--ui-text-muted);
    flex-shrink: 0;
  }

  @media (max-width: 480px) {
    .setting-row {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--ui-space-xs);
    }

    .setting-row .ui-select.ui-select--compact {
      width: 100%;
      min-width: unset;
    }

    .select-wrapper {
      width: 100%;
    }

    .select-wrapper .ui-select--wrapped {
      width: 100%;
    }
  }
</style>
