<!--
  @file ToolboxPanel.vue
  @description 工具箱面板组件

  提供可拖拽的组件磁贴和约束类型折叠面板。
-->

<template>
  <div class="tab-content toolbox-content">
    <div class="toolbox-section">
      <div class="subsection-header">CORE COMPONENTS</div>

      <div class="component-tiles">
        <!-- Project Root -->
        <ToolboxTile
          :tool="{
            id: 'projectRoot',
            label: 'Project Root',
            iconClass: 'tile-icon-amber',
            iconSvg: ICONS.projectRoot,
          }"
          draggable
          @dragstart="(e) => handleToolboxDragStart(e, 'projectRoot')"
          @dragend="handleDragEnd"
        >
          <template #action>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              @click="createProjectRoot"
            >
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </template>
        </ToolboxTile>

        <!-- Table Schema -->
        <ToolboxTile
          :tool="{
            id: 'schema',
            label: 'Table Schema',
            iconClass: 'tile-icon-blue',
            iconSvg: ICONS.schema,
          }"
          draggable
          @dragstart="(e) => handleToolboxDragStart(e, 'schema')"
          @dragend="handleDragEnd"
        >
          <template #action>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              @click="createTableSchema"
            >
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </template>
        </ToolboxTile>

        <!-- JSON Schema -->
        <ToolboxTile
          :tool="{
            id: 'jsonSchema',
            label: 'JSON Schema',
            iconClass: 'tile-icon-green',
            iconSvg: ICONS.jsonSchema,
          }"
          draggable
          @dragstart="(e) => handleToolboxDragStart(e, 'jsonSchema')"
          @dragend="handleDragEnd"
        >
          <template #action>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              @click="createJsonSchema"
            >
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </template>
        </ToolboxTile>

        <!-- Manual Data -->
        <ToolboxTile
          :tool="{
            id: 'manualData',
            label: 'Manual Data',
            iconClass: 'tile-icon-pink',
            iconSvg: ICONS.manualData,
          }"
          draggable
          @dragstart="(e) => handleManualDataDragStart(e)"
          @dragend="handleDragEnd"
        >
          <template #action>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              @click="createManualData"
            >
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </template>
        </ToolboxTile>

        <!-- Regex Pattern -->
        <ToolboxTile
          :tool="{
            id: 'pattern',
            label: 'Regex Pattern',
            iconClass: 'tile-icon-purple',
            iconSvg: ICONS.pattern,
          }"
          draggable
          @dragstart="(e) => handleToolboxDragStart(e, 'pattern')"
          @dragend="handleDragEnd"
        >
          <template #action>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              @click="createRegexPattern"
            >
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </template>
        </ToolboxTile>

        <!-- Template Instance -->
        <ToolboxTile
          :tool="{
            id: 'templateInstance',
            label: 'Template Instance',
            iconClass: 'tile-icon-purple',
            iconSvg: ICONS.templateInstance,
          }"
          draggable
          @dragstart="(e) => handleToolboxDragStart(e, 'templateInstance')"
          @dragend="handleDragEnd"
        >
          <template #action>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              @click="createTemplateInstance"
            >
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </template>
        </ToolboxTile>

        <!-- Transform Node -->
        <ToolboxTile
          :tool="{
            id: 'transform',
            label: 'Transform',
            iconClass: 'tile-icon-sky',
            iconSvg: ICONS.transform,
          }"
          :draggable="false"
        >
          <template #action>
            <span
              class="tile-expand-icon"
              :class="{ expanded: transformPanelExpanded }"
              @click.stop="toggleTransformPanel"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </span>
          </template>
        </ToolboxTile>

        <Transition name="accordion">
          <div v-if="transformPanelExpanded" class="constraint-panel">
            <div
              v-for="tItem in transformTypes"
              :key="tItem.id"
              class="constraint-type-item"
              draggable="true"
              @dragstart="(e) => handleTransformTypeDragStart(e, tItem.transformType)"
              @dragend="handleDragEnd"
              @click="handleTransformTypeClick(tItem)"
            >
              <span class="constraint-type-icon" v-html="tItem.icon"></span>
              <span class="constraint-type-name">{{ t(tItem.nameKey) }}</span>
              <span class="constraint-type-grip">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <circle cx="9" cy="12" r="1" />
                  <circle cx="9" cy="5" r="1" />
                  <circle cx="9" cy="19" r="1" />
                  <circle cx="15" cy="12" r="1" />
                  <circle cx="15" cy="5" r="1" />
                  <circle cx="15" cy="19" r="1" />
                </svg>
              </span>
            </div>
          </div>
        </Transition>

        <!-- Constraint Node -->
        <ToolboxTile
          :tool="{
            id: 'constraint',
            label: 'Constraint',
            iconClass: 'tile-icon-amber',
            iconSvg: ICONS.constraint,
          }"
          :draggable="false"
        >
          <template #action>
            <span
              class="tile-expand-icon"
              :class="{ expanded: constraintPanelExpanded }"
              @click.stop="toggleConstraintPanel"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </span>
          </template>
        </ToolboxTile>

        <Transition name="accordion">
          <div v-if="constraintPanelExpanded" class="constraint-panel">
            <!-- Attribute Constraints -->
            <div class="constraint-category">
              <div class="constraint-category-title">
                {{ t('assetLibraryExtended.projectView.toolbox.constraintCategories.attribute') }}
              </div>
              <div
                v-for="constraint in attributeConstraints"
                :key="constraint.id"
                class="constraint-type-item"
                :class="{ disabled: isConstraintDisabled(constraint) }"
                draggable="true"
                @dragstart="(e) => handleConstraintTypeDragStart(e, constraint.constraintType)"
                @dragend="handleDragEnd"
                @click="handleConstraintTypeClick(constraint)"
              >
                <span class="constraint-type-icon" v-html="constraint.icon"></span>
                <span class="constraint-type-name">{{ constraint.name }}</span>
                <span class="constraint-type-grip">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <circle cx="9" cy="12" r="1" />
                    <circle cx="9" cy="5" r="1" />
                    <circle cx="9" cy="19" r="1" />
                    <circle cx="15" cy="12" r="1" />
                    <circle cx="15" cy="5" r="1" />
                    <circle cx="15" cy="19" r="1" />
                  </svg>
                </span>
              </div>
            </div>

            <!-- Relation Constraints -->
            <div class="constraint-category">
              <div class="constraint-category-title">
                {{ t('assetLibraryExtended.projectView.toolbox.constraintCategories.relation') }}
              </div>
              <div
                v-for="constraint in relationConstraints"
                :key="constraint.id"
                class="constraint-type-item"
                :class="{ disabled: isConstraintDisabled(constraint) }"
                draggable="true"
                @dragstart="(e) => handleConstraintTypeDragStart(e, constraint.constraintType)"
                @dragend="handleDragEnd"
                @click="handleConstraintTypeClick(constraint)"
              >
                <span class="constraint-type-icon" v-html="constraint.icon"></span>
                <span class="constraint-type-name">{{ constraint.name }}</span>
                <span class="constraint-type-grip">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <circle cx="9" cy="12" r="1" />
                    <circle cx="9" cy="5" r="1" />
                    <circle cx="9" cy="19" r="1" />
                    <circle cx="15" cy="12" r="1" />
                    <circle cx="15" cy="5" r="1" />
                    <circle cx="15" cy="19" r="1" />
                  </svg>
                </span>
              </div>
            </div>

            <!-- Logic Constraints -->
            <div class="constraint-category">
              <div class="constraint-category-title">
                {{ t('assetLibraryExtended.projectView.toolbox.constraintCategories.logic') }}
              </div>
              <div
                v-for="constraint in logicConstraints"
                :key="constraint.id"
                class="constraint-type-item"
                :class="{ disabled: isConstraintDisabled(constraint) }"
                draggable="true"
                @dragstart="(e) => handleConstraintTypeDragStart(e, constraint.constraintType)"
                @dragend="handleDragEnd"
                @click="handleConstraintTypeClick(constraint)"
              >
                <span class="constraint-type-icon" v-html="constraint.icon"></span>
                <span class="constraint-type-name">{{ constraint.name }}</span>
                <span class="constraint-type-grip">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <circle cx="9" cy="12" r="1" />
                    <circle cx="9" cy="5" r="1" />
                    <circle cx="9" cy="19" r="1" />
                    <circle cx="15" cy="12" r="1" />
                    <circle cx="15" cy="5" r="1" />
                    <circle cx="15" cy="19" r="1" />
                  </svg>
                </span>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </div>

    <ConstraintRuleTypeMenu
      :visible="constraintMenuVisible"
      :position="constraintMenuPosition"
      @select-constraint-type="handleConstraintTypeSelect"
      @close-menu="constraintMenuVisible = false"
    />
  </div>
</template>

<script setup lang="ts">
  import { ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import ToolboxTile from './ToolboxTile.vue'
  import ConstraintRuleTypeMenu, {
    type ConstraintRuleTypeOption,
  } from '../shared/menus/ConstraintRuleTypeMenu.vue'
  import {
    useConstraintTypes,
    type ConstraintTypeItem,
  } from '@/composables/resource/useConstraintTypes'
  import { useToolboxCreators } from '@/composables/resource/useToolboxCreators'
  import { useResourceDrag } from '@/composables/resource'

  const { t } = useI18n()
  const { attributeConstraints, relationConstraints, logicConstraints, isConstraintDisabled } =
    useConstraintTypes()
  const {
    createProjectRoot,
    createTableSchema,
    createJsonSchema,
    createRegexPattern,
    createConstraintNode,
    createTransform,
    createManualData,
    createTemplateInstance,
  } = useToolboxCreators()
  const {
    handleToolboxDragStart,
    handleConstraintTypeDragStart,
    handleTransformTypeDragStart,
    handleManualDataDragStart,
    handleDragEnd,
  } = useResourceDrag()

  const constraintPanelExpanded = ref(false)
  const toggleConstraintPanel = () => {
    constraintPanelExpanded.value = !constraintPanelExpanded.value
  }

  const transformPanelExpanded = ref(false)
  const toggleTransformPanel = () => {
    transformPanelExpanded.value = !transformPanelExpanded.value
  }

  const constraintMenuVisible = ref(false)
  const constraintMenuPosition = ref({ x: 0, y: 0 })

  const handleConstraintTypeClick = (constraint: ConstraintTypeItem) => {
    if (isConstraintDisabled(constraint)) {
      return
    }
    createConstraintNode(constraint.constraintType)
  }

  interface TransformTypeItem {
    id: string
    nameKey: string
    transformType:
      | 'StringSplit'
      | 'RegexExtract'
      | 'MathExpr'
      | 'DateFormat'
      | 'Lookup'
      | 'Strip'
      | 'UpperCase'
      | 'LowerCase'
      | 'Replace'
      | 'FilterRows'
      | 'FillNA'
      | 'DropDuplicates'
      | 'CastType'
      | 'Concat'
      | 'Substring'
      | 'Aggregate'
      | 'ConditionalAssign'
      | 'SortRows'
      | 'Digits'
      | 'WeightedSum'
      | 'Modulo'
      | 'MapValue'
    icon: string
  }

  const transformTypes: TransformTypeItem[] = [
    {
      id: 'string-split',
      nameKey: 'customNodes.transformNode.types.stringSplit',
      transformType: 'StringSplit',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16"></path><path d="M12 4v16"></path></svg>',
    },
    {
      id: 'regex-extract',
      nameKey: 'customNodes.transformNode.types.regexExtract',
      transformType: 'RegexExtract',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>',
    },
    {
      id: 'math-expr',
      nameKey: 'customNodes.transformNode.types.mathExpr',
      transformType: 'MathExpr',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"></path><path d="M4 12h16"></path><path d="M4 17h16"></path></svg>',
    },
    {
      id: 'date-format',
      nameKey: 'customNodes.transformNode.types.dateFormat',
      transformType: 'DateFormat',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>',
    },
    {
      id: 'lookup',
      nameKey: 'customNodes.transformNode.types.lookup',
      transformType: 'Lookup',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>',
    },
    {
      id: 'strip',
      nameKey: 'customNodes.transformNode.types.strip',
      transformType: 'Strip',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16"></path></svg>',
    },
    {
      id: 'upper-case',
      nameKey: 'customNodes.transformNode.types.upperCase',
      transformType: 'UpperCase',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"></path><path d="M4 12h16"></path><path d="M4 17h16"></path></svg>',
    },
    {
      id: 'lower-case',
      nameKey: 'customNodes.transformNode.types.lowerCase',
      transformType: 'LowerCase',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"></path><path d="M4 12h16"></path><path d="M4 17h16"></path></svg>',
    },
    {
      id: 'replace',
      nameKey: 'customNodes.transformNode.types.replace',
      transformType: 'Replace',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>',
    },
    {
      id: 'filter-rows',
      nameKey: 'customNodes.transformNode.types.filterRows',
      transformType: 'FilterRows',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>',
    },
    {
      id: 'fill-na',
      nameKey: 'customNodes.transformNode.types.fillNA',
      transformType: 'FillNA',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>',
    },
    {
      id: 'drop-duplicates',
      nameKey: 'customNodes.transformNode.types.dropDuplicates',
      transformType: 'DropDuplicates',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>',
    },
    {
      id: 'cast-type',
      nameKey: 'customNodes.transformNode.types.castType',
      transformType: 'CastType',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3"></path><path d="M9 20h6"></path><path d="M12 4v16"></path></svg>',
    },
    {
      id: 'concat',
      nameKey: 'customNodes.transformNode.types.concat',
      transformType: 'Concat',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>',
    },
    {
      id: 'substring',
      nameKey: 'customNodes.transformNode.types.substring',
      transformType: 'Substring',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3"></path><path d="M9 20h6"></path><path d="M12 4v16"></path><path d="M8 12h8"></path></svg>',
    },
    {
      id: 'aggregate',
      nameKey: 'customNodes.transformNode.types.aggregate',
      transformType: 'Aggregate',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"></path><path d="m19 9-5 5-4-4-3 3"></path></svg>',
    },
    {
      id: 'conditional-assign',
      nameKey: 'customNodes.transformNode.types.conditionalAssign',
      transformType: 'ConditionalAssign',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><path d="m9 12 2 2 4-4"></path></svg>',
    },
    {
      id: 'sort-rows',
      nameKey: 'customNodes.transformNode.types.sortRows',
      transformType: 'SortRows',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 16 4 4 4-4"></path><path d="M7 20V4"></path><path d="m21 8-4-4-4 4"></path><path d="M17 4v16"></path></svg>',
    },
    {
      id: 'digits',
      nameKey: 'customNodes.transformNode.types.digits',
      transformType: 'Digits',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"></path><path d="M4 12h16"></path><path d="M4 17h16"></path></svg>',
    },
    {
      id: 'weighted-sum',
      nameKey: 'customNodes.transformNode.types.weightedSum',
      transformType: 'WeightedSum',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3"></path><path d="M9 20h6"></path><path d="M12 4v16"></path><path d="M8 12h8"></path></svg>',
    },
    {
      id: 'modulo',
      nameKey: 'customNodes.transformNode.types.modulo',
      transformType: 'Modulo',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16"></path><path d="M12 4v16"></path></svg>',
    },
    {
      id: 'map-value',
      nameKey: 'customNodes.transformNode.types.mapValue',
      transformType: 'MapValue',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>',
    },
  ]

  const handleTransformTypeClick = (tItem: TransformTypeItem) => {
    createTransform(tItem.transformType)
  }

  const handleConstraintTypeSelect = (
    constraintType: ConstraintRuleTypeOption,

    _nodeData: Record<string, unknown>
  ) => {
    createConstraintNode(constraintType.constraintType)
    constraintMenuVisible.value = false
  }

  const ICONS = {
    projectRoot:
      '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"></path><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"></path></svg>',
    schema:
      '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect></svg>',
    jsonSchema:
      '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"></path><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"></path></svg>',
    pattern:
      '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>',
    constraint:
      '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>',
    manualData:
      '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>',
    transform:
      '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>',
    templateInstance:
      '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect></svg>',
  }

  const emit = defineEmits<{
    dragstart: [payload: { type: string; source: string; meta?: Record<string, unknown> }]
    dragend: []
    'create-node': [type: string]
  }>()
</script>

<style scoped src="./ToolboxPanel.styles.css"></style>
