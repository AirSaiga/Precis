<!--
  @file MigratePanel.vue
  @description AI 配置迁移面板（批量文件 + 单脚本双模式）

  功能职责：
  - 支持批量选择项目内脚本文件，自动识别语言类型
  - 支持切换到单脚本粘贴模式
  - 展示已选脚本来源列表，可删除
  - 调用 startMigration 提交迁移任务

  Props:
    - generating: boolean
    - canceling: boolean
    - provider: CloudAIProviderResponse | null
    - checkedFiles: Set<string>  数据文件
    - projectName: string

  Emits:
    - start-migration: (sources: AiMigrateV2ConfigSource[]) => void
    - cancel-migration: () => void
-->
<template>
  <div class="migrate-panel">
    <div class="migrate-layout">
      <!-- 左侧：来源输入 -->
      <div class="migrate-sources">
        <div class="source-mode-tabs">
          <button
            class="source-mode-tab"
            :class="{ active: sourceMode === 'files' }"
            @click="sourceMode = 'files'"
          >
            {{ t('aiConfigGenerator.migrate.sourceMode.files') }}
          </button>
          <button
            class="source-mode-tab"
            :class="{ active: sourceMode === 'paste' }"
            @click="sourceMode = 'paste'"
          >
            {{ t('aiConfigGenerator.migrate.sourceMode.paste') }}
          </button>
        </div>

        <!-- 批量文件模式 -->
        <div v-if="sourceMode === 'files'" class="source-files-mode">
          <div class="file-picker-row">
            <button class="action-btn" type="button" @click="emit('pick-script-files')">
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
                <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
                <path d="M14 2v4a2 2 0 0 0 2 2h4" />
              </svg>
              {{ t('aiConfigGenerator.migrate.pickScriptFiles') }}
            </button>
            <button class="action-btn" type="button" @click="emit('pick-script-folder')">
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
                <path
                  d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
                />
              </svg>
              {{ t('aiConfigGenerator.migrate.pickScriptFolder') }}
            </button>
          </div>

          <div v-if="sources.length === 0" class="migrate-empty">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
              <polyline points="14 2 14 8 20 8" />
              <path d="M12 18v-6" />
              <path d="M9 15l3-3 3 3" />
            </svg>
            <p>{{ t('aiConfigGenerator.migrate.emptyFiles') }}</p>
          </div>

          <div v-else class="source-list">
            <div v-for="(source, idx) in sources" :key="source.name ?? idx" class="source-item">
              <span class="source-language" :class="source.language">{{ source.language }}</span>
              <span class="source-name" :title="source.name ?? ''">{{ source.name }}</span>
              <button
                class="source-remove"
                type="button"
                :disabled="generating"
                @click="removeSource(idx)"
              >
                ×
              </button>
            </div>
          </div>
        </div>

        <!-- 单脚本粘贴模式 -->
        <div v-else class="source-paste-mode">
          <label class="paste-field">
            <span>{{ t('aiConfigGenerator.migrate.language') }}</span>
            <select v-model="pasteLanguage" :disabled="generating">
              <option value="python">
                {{ t('aiConfigGenerator.migrate.scriptLanguages.python') }}
              </option>
              <option value="natural_language">
                {{ t('aiConfigGenerator.migrate.scriptLanguages.naturalLanguage') }}
              </option>
              <option value="excel_formula">
                {{ t('aiConfigGenerator.migrate.scriptLanguages.excelFormula') }}
              </option>
              <option value="sql">
                {{ t('aiConfigGenerator.migrate.scriptLanguages.sqlDdl') }}
              </option>
            </select>
          </label>
          <textarea
            v-model="pasteContent"
            class="migrate-textarea"
            :disabled="generating"
            :placeholder="t('aiConfigGenerator.migrate.placeholder')"
            rows="10"
          />
        </div>

        <div class="migrate-actions">
          <button
            class="generate-btn"
            type="button"
            :disabled="
              generating ||
              checkedFiles.size === 0 ||
              !provider?.is_configured ||
              !canStartMigration
            "
            @click="handleStart"
          >
            <span v-if="generating" class="spinner-sm"></span>
            {{
              generating
                ? t('aiConfigGenerator.actions.generating')
                : t('aiConfigGenerator.migrate.start')
            }}
          </button>
          <button
            v-if="generating"
            class="cancel-btn"
            type="button"
            :disabled="canceling"
            @click="emit('cancel-migration')"
          >
            {{
              canceling
                ? t('aiConfigGenerator.actions.canceling')
                : t('aiConfigGenerator.actions.cancel')
            }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { AiMigrateV2ConfigSource, CloudAIProviderResponse } from '@/types/ai'

  const props = defineProps<{
    generating: boolean
    canceling: boolean
    provider: CloudAIProviderResponse | null
    checkedFiles: Set<string>
    sources: AiMigrateV2ConfigSource[]
  }>()

  const emit = defineEmits<{
    'start-migration': [sources: AiMigrateV2ConfigSource[]]
    'cancel-migration': []
    'pick-script-files': []
    'pick-script-folder': []
    'update:sources': [sources: AiMigrateV2ConfigSource[]]
  }>()

  const { t } = useI18n()
  const sourceMode = ref<'files' | 'paste'>('files')
  const pasteLanguage = ref('python')
  const pasteContent = ref('')

  const canStartMigration = computed(() => {
    if (sourceMode.value === 'files') {
      return props.sources.length > 0
    }
    return pasteContent.value.trim().length > 0
  })

  const removeSource = (idx: number) => {
    const next = [...props.sources]
    next.splice(idx, 1)
    emit('update:sources', next)
  }

  const handleStart = () => {
    if (sourceMode.value === 'paste') {
      emit('start-migration', [
        { content: pasteContent.value, language: pasteLanguage.value, name: 'manual_paste' },
      ])
      return
    }
    emit('start-migration', props.sources)
  }
</script>

<style scoped src="./MigratePanel.styles.css"></style>
