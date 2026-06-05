<!--
  @file ResourceTree.vue
  @description 资源树主体组件

  渲染项目资源的完整树形结构，包括文件夹、Schema、Constraint、Pattern 和 Regex Node。
-->

<template>
  <div class="resource-tree">
    <!-- 项目配置文件行 -->
    <div
      class="tree-row file-row root-item"
      draggable="true"
      @dragstart="emit('project-config-dragstart', $event)"
      @dragend="emit('dragend')"
    >
      <svg
        class="file-icon"
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
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
      </svg>
      <span class="file-name">{{
        t('assetLibraryExtended.projectView.explorer.projectConfig')
      }}</span>
    </div>

    <!-- 数据模型 (Data Models) -->
    <div class="tree-folder root-item">
      <div class="tree-row folder-row" @click="emit('toggle-folder', 'dataModels')">
        <svg
          class="folder-icon"
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
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="3" y1="9" x2="21" y2="9"></line>
          <line x1="9" y1="21" x2="9" y2="9"></line>
        </svg>
        <span class="folder-name">{{
          t('assetLibraryExtended.projectView.explorer.dataModels')
        }}</span>
        <span v-if="filteredFolders.dataModels?.count > 0" class="folder-count">
          {{ filteredFolders.dataModels?.count }}
        </span>
      </div>
      <div v-if="filteredFolders.dataModels?.expanded" class="tree-children">
        <!-- Schemas 子文件夹 -->
        <div class="tree-folder nested">
          <div class="tree-row folder-row" @click="emit('toggle-folder', 'schemas')">
            <svg
              class="folder-icon"
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
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
            </svg>
            <span class="folder-name">{{
              t('assetLibraryExtended.projectView.explorer.schemas')
            }}</span>
            <span
              v-if="(filteredFolders.dataModels?.children?.[0]?.count ?? 0) > 0"
              class="folder-count"
            >
              {{ filteredFolders.dataModels?.children?.[0]?.count }}
            </span>
          </div>
          <div v-if="filteredFolders.dataModels?.children?.[0]?.expanded" class="tree-children">
            <div
              v-for="schema in filteredFolders.dataModels?.children?.[0]?.resources"
              :key="schema.id"
            >
              <!-- Schema 行 -->
              <ResourceTreeItem
                :item="schema"
                :is-selected="selectedIds.has(schema.id)"
                :is-multi-select-mode="isMultiSelectMode"
                :is-expanded="expandedSchemas.has(schema.id)"
                :has-embedded-constraints="
                  ((schema as SchemaResource).embeddedConstraints?.length ?? 0) > 0
                "
                :is-on-canvas="isNodeOnCanvas(schema.id)"
                :is-unlisted="isUnlistedInManifest(schema)"
                :parse-error="getSchemaParseError(schema)"
                @toggle="emit('toggle-schema-expand', schema.id)"
                @toggle-select="emit('toggle-select', schema)"
                @select="(e) => handleResourceSelect(schema, e)"
                @dragstart="(e) => handleResourceDragStart(e, schema)"
                @dragend="emit('dragend')"
                @contextmenu="(e) => emit('contextmenu', e, 'schema', schema)"
                @mousedown="emit('resource-mousedown', schema)"
                @mouseup="emit('resource-mouseup')"
                @mouseleave="emit('resource-mouseleave')"
              />

              <!-- 内嵌约束子节点列表 -->
              <div
                v-if="
                  expandedSchemas?.has(schema.id) &&
                  ((schema as SchemaResource).embeddedConstraints?.length ?? 0) > 0
                "
                class="tree-children embedded-constraints"
              >
                <div
                  v-for="ec in (schema as SchemaResource).embeddedConstraints"
                  :key="ec.id"
                  class="tree-row embedded-constraint-row"
                  :class="{ selected: isMultiSelectMode && selectedIds.has(ec.id) }"
                  @click.stop="emit('embedded-constraint-click', schema, ec)"
                >
                  <svg
                    class="embedded-icon"
                    xmlns="http://www.w3.org/2000/svg"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <polyline points="16 18 22 12 16 6"></polyline>
                    <polyline points="8 6 2 12 8 18"></polyline>
                  </svg>
                  <span class="embedded-constraint-name">{{ ec.name }}</span>
                </div>
              </div>
            </div>
            <div v-if="filteredFolders.dataModels?.children?.[0]?.count === 0" class="tree-empty">
              {{ t('assetLibraryExtended.projectView.explorer.emptySchemas') }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 校验资产库 (Validation Assets) -->
    <div class="tree-folder root-item">
      <div class="tree-row folder-row" @click="emit('toggle-folder', 'validationAssets')">
        <svg
          class="folder-icon"
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
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
        </svg>
        <span class="folder-name">{{
          t('assetLibraryExtended.projectView.explorer.validationAssets')
        }}</span>
        <span v-if="filteredFolders.validationAssets?.count > 0" class="folder-count">
          {{ filteredFolders.validationAssets?.count }}
        </span>
      </div>
      <div v-if="filteredFolders.validationAssets?.expanded" class="tree-children">
        <!-- 独立约束文件夹 -->
        <div class="tree-folder nested">
          <div class="tree-row folder-row" @click="emit('toggle-folder', 'independentConstraints')">
            <svg
              class="folder-icon"
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
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
            </svg>
            <span class="folder-name">{{
              t('assetLibraryExtended.projectView.explorer.independentConstraints')
            }}</span>
            <span
              v-if="(filteredFolders.validationAssets?.children?.[0]?.count ?? 0) > 0"
              class="folder-count"
            >
              {{ filteredFolders.validationAssets?.children?.[0]?.count }}
            </span>
          </div>
          <div
            v-if="filteredFolders.validationAssets?.children?.[0]?.expanded"
            class="tree-children"
          >
            <ResourceTreeItem
              v-for="constraint in filteredFolders.validationAssets?.children?.[0]?.resources"
              :key="constraint.id"
              :item="constraint"
              :is-selected="selectedIds.has(constraint.id)"
              :is-multi-select-mode="isMultiSelectMode"
              :is-on-canvas="isNodeOnCanvas(constraint.id)"
              :is-unlisted="isUnlistedInManifest(constraint)"
              @toggle-select="emit('toggle-select', constraint)"
              @select="(e) => handleResourceSelect(constraint, e)"
              @dragstart="(e) => handleResourceDragStart(e, constraint)"
              @dragend="emit('dragend')"
              @contextmenu="(e) => emit('contextmenu', e, 'constraint', constraint)"
              @mousedown="emit('resource-mousedown', constraint)"
              @mouseup="emit('resource-mouseup')"
              @mouseleave="emit('resource-mouseleave')"
            />
            <div
              v-if="filteredFolders.validationAssets?.children?.[0]?.count === 0"
              class="tree-empty"
            >
              {{ t('assetLibraryExtended.projectView.explorer.emptyConstraints') }}
            </div>
          </div>
        </div>

        <!-- 模板文件夹 -->
        <div class="tree-folder nested">
          <div class="tree-row folder-row" @click="emit('toggle-folder', 'templates')">
            <svg
              class="folder-icon"
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
              <rect x="3" y="3" width="7" height="7" rx="1"></rect>
              <rect x="14" y="3" width="7" height="7" rx="1"></rect>
              <rect x="3" y="14" width="7" height="7" rx="1"></rect>
              <rect x="14" y="14" width="7" height="7" rx="1"></rect>
            </svg>
            <span class="folder-name">{{
              t('assetLibraryExtended.projectView.explorer.templates')
            }}</span>
            <span
              v-if="(filteredFolders.validationAssets?.children?.find(c => c.id === 'templates')?.count ?? 0) > 0"
              class="folder-count"
            >
              {{ filteredFolders.validationAssets?.children?.find(c => c.id === 'templates')?.count }}
            </span>
          </div>
          <div
            v-if="filteredFolders.validationAssets?.children?.find(c => c.id === 'templates')?.expanded"
            class="tree-children"
          >
            <ResourceTreeItem
              v-for="template in filteredFolders.validationAssets?.children?.find(c => c.id === 'templates')?.resources"
              :key="template.id"
              :item="template"
              :is-selected="selectedIds.has(template.id)"
              :is-multi-select-mode="isMultiSelectMode"
              :is-on-canvas="isNodeOnCanvas(template.id)"
              :is-unlisted="isUnlistedInManifest(template)"
              @toggle-select="emit('toggle-select', template)"
              @select="(e) => handleResourceSelect(template, e)"
              @dragstart="(e) => handleResourceDragStart(e, template)"
              @dragend="emit('dragend')"
              @contextmenu="(e) => emit('contextmenu', e, 'template', template)"
              @mousedown="emit('resource-mousedown', template)"
              @mouseup="emit('resource-mouseup')"
              @mouseleave="emit('resource-mouseleave')"
            />
            <div
              v-if="filteredFolders.validationAssets?.children?.find(c => c.id === 'templates')?.count === 0"
              class="tree-empty"
            >
              {{ t('assetLibraryExtended.projectView.explorer.emptyTemplates') }}
            </div>
          </div>
        </div>

        <!-- 正则中心 -->
        <div class="tree-folder nested">
          <div class="tree-row folder-row" @click="emit('toggle-folder', 'regexCenter')">
            <svg
              class="folder-icon"
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
              <polyline points="16 18 22 12 16 6"></polyline>
              <polyline points="8 6 2 12 8 18"></polyline>
            </svg>
            <span class="folder-name">{{
              t('assetLibraryExtended.projectView.explorer.regexCenter')
            }}</span>
            <span
              v-if="(filteredFolders.validationAssets?.children?.[1]?.count ?? 0) > 0"
              class="folder-count"
            >
              {{ filteredFolders.validationAssets?.children?.[1]?.count }}
            </span>
          </div>
          <div
            v-if="filteredFolders.validationAssets?.children?.[1]?.expanded"
            class="tree-children"
          >
            <!-- Patterns 子文件夹 -->
            <div class="tree-folder nested">
              <div class="tree-row folder-row" @click="emit('toggle-folder', 'patterns')">
                <svg
                  class="folder-icon"
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
                  <path d="m16 6 4 14" />
                  <path d="M12 6v14" />
                  <path d="M8 8v12" />
                  <path d="M4 4v16" />
                </svg>
                <span class="folder-name">{{
                  t('assetLibraryExtended.projectView.explorer.patternRegistry')
                }}</span>
                <span
                  v-if="(filteredFolders.validationAssets?.children?.[1]?.children?.[0]?.count ?? 0) > 0"
                  class="folder-count"
                >
                  {{ filteredFolders.validationAssets?.children?.[1]?.children?.[0]?.count }}
                </span>
              </div>
              <div
                v-if="filteredFolders.validationAssets?.children?.[1]?.children?.[0]?.expanded"
                class="tree-children"
              >
                <ResourceTreeItem
                  v-for="pattern in filteredFolders.validationAssets?.children?.[1]?.children?.[0]?.resources"
                  :key="pattern.id"
                  :item="pattern"
                  :is-selected="selectedIds.has(pattern.id)"
                  :is-multi-select-mode="isMultiSelectMode"
                  :is-on-canvas="isNodeOnCanvas(pattern.id)"
                  :is-unlisted="isUnlistedInManifest(pattern)"
                  @toggle-select="emit('toggle-select', pattern)"
                  @select="(e) => handleResourceSelect(pattern, e)"
                  @dragstart="(e) => handleResourceDragStart(e, pattern)"
                  @dragend="emit('dragend')"
                  @contextmenu="(e) => emit('contextmenu', e, 'pattern', pattern)"
                  @mousedown="emit('resource-mousedown', pattern)"
                  @mouseup="emit('resource-mouseup')"
                  @mouseleave="emit('resource-mouseleave')"
                />
                <div
                  v-if="filteredFolders.validationAssets?.children?.[1]?.children?.[0]?.count === 0"
                  class="tree-empty"
                >
                  {{ t('assetLibraryExtended.projectView.explorer.emptyPatterns') }}
                </div>
              </div>
            </div>

            <!-- Regex Nodes 子文件夹 -->
            <div class="tree-folder nested">
              <div class="tree-row folder-row" @click="emit('toggle-folder', 'regex_nodes')">
                <svg
                  class="folder-icon"
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
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                </svg>
                <span class="folder-name">{{
                  t('assetLibraryExtended.projectView.explorer.regexNodes')
                }}</span>
                <span
                  v-if="(filteredFolders.validationAssets?.children?.[1]?.children?.[1]?.count ?? 0) > 0"
                  class="folder-count"
                >
                  {{ filteredFolders.validationAssets?.children?.[1]?.children?.[1]?.count }}
                </span>
              </div>
              <div
                v-if="filteredFolders.validationAssets?.children?.[1]?.children?.[1]?.expanded"
                class="tree-children"
              >
                <ResourceTreeItem
                  v-for="regexNode in filteredFolders.validationAssets?.children?.[1]?.children?.[1]?.resources"
                  :key="regexNode.id"
                  :item="regexNode"
                  :is-selected="selectedIds.has(regexNode.id)"
                  :is-multi-select-mode="isMultiSelectMode"
                  :is-on-canvas="isNodeOnCanvas(regexNode.id)"
                  :is-unlisted="isUnlistedInManifest(regexNode)"
                  @toggle-select="emit('toggle-select', regexNode)"
                  @select="(e) => handleResourceSelect(regexNode, e)"
                  @dragstart="(e) => handleResourceDragStart(e, regexNode)"
                  @dragend="emit('dragend')"
                  @contextmenu="(e) => emit('contextmenu', e, 'regex_node', regexNode)"
                  @mousedown="emit('resource-mousedown', regexNode)"
                  @mouseup="emit('resource-mouseup')"
                  @mouseleave="emit('resource-mouseleave')"
                />
                <div
                  v-if="filteredFolders.validationAssets?.children?.[1]?.children?.[1]?.count === 0"
                  class="tree-empty"
                >
                  {{ t('assetLibraryExtended.projectView.explorer.emptyRegexNodes') }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { useI18n } from 'vue-i18n'
  import { useGraphStore } from '@/stores/graphStore'
  import ResourceTreeItem from './ResourceTreeItem.vue'
  import type { ResourceItem, SchemaResource, ResourceFolder, ResourceFolderMap } from '@/types/resource'

  interface Props {
    filteredFolders: ResourceFolderMap
    expandedSchemas: Set<string>
    isMultiSelectMode: boolean
    selectedIds: Set<string>
  }

  defineProps<Props>()

  const emit = defineEmits<{
    'toggle-folder': [folderId: string]
    'toggle-schema-expand': [schemaId: string]
    'toggle-select': [resource: ResourceItem]
    'resource-select': [resource: ResourceItem, event: MouseEvent]
    'resource-mousedown': [resource: ResourceItem]
    'resource-mouseup': []
    'resource-mouseleave': []
    'resource-dragstart': [event: DragEvent, resource: ResourceItem]
    dragend: []
    contextmenu: [
      event: MouseEvent,
      kind: 'schema' | 'pattern' | 'constraint' | 'regex_node' | 'template',
      resource: ResourceItem,
    ]
    'project-config-dragstart': [event: DragEvent]
    'embedded-constraint-click': [schema: ResourceItem, ec: unknown]
  }>()

  const { t } = useI18n()
  const graphStore = useGraphStore()

  const isNodeOnCanvas = (nodeId: string): boolean => {
    return graphStore.nodes.some((node) => node.id === nodeId)
  }

  const isUnlistedInManifest = (item: ResourceItem): boolean => {
    return item.meta?.listedInManifest === false
  }

  const getSchemaParseError = (item: ResourceItem): string | null => {
    return item.meta?.parseError ? String(item.meta.parseError) : null
  }

  const handleResourceSelect = (resource: ResourceItem, event: MouseEvent): void => {
    emit('resource-select', resource, event)
  }

  const handleResourceDragStart = (event: DragEvent, resource: ResourceItem): void => {
    emit('resource-dragstart', event, resource)
  }
</script>

<style scoped src="./ResourceTree.styles.css" />
