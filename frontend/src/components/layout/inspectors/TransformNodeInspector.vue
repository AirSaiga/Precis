<!--
  @file TransformNodeInspector.vue
  @description Transform 节点属性检查器

  可编辑属性：
  - configName: 配置名称
  - transformType: 转换类型（只读选择器，创建时确定）
  - description: 描述
  - inputColumn: 输入列名
  - outputColumns: 输出列列表
  - params: 参数（JSON 编辑器）
  - enabled: 是否启用
-->
<template>
  <div class="transform-inspector">
    <!-- 1. 基础配置 -->
    <BaseInspector
      :title="t('inspector.transformNode.groups.config')"
      :badge="t('inspector.transformNode.badgeEditable')"
      badge-class="editable"
    >
      <InspectorField
        :label="t('inspector.transformNode.labels.configName')"
        :model-value="data.configName || ''"
        :editable="true"
        :placeholder="t('inspector.transformNode.placeholders.configName')"
        @update:model-value="emitUpdate('configName', $event)"
      />
      <InspectorField
        :label="t('inspector.transformNode.labels.transformType')"
        :model-value="typeDisplay"
        :editable="false"
      />
      <InspectorField
        :label="t('inspector.transformNode.labels.description')"
        :model-value="data.description || ''"
        :editable="true"
        @update:model-value="emitUpdate('description', $event)"
      />
    </BaseInspector>

    <!-- 2. 输入输出 -->
    <BaseInspector
      :title="t('inspector.transformNode.groups.io')"
      :badge="t('inspector.transformNode.badgeEditable')"
      badge-class="editable"
    >
      <InspectorField
        :label="t('inspector.transformNode.labels.inputColumn')"
        :model-value="data.inputColumn || ''"
        :editable="true"
        :placeholder="t('inspector.transformNode.placeholders.inputColumn')"
        @update:model-value="emitUpdate('inputColumn', $event)"
      />
      <div class="form-group">
        <label>{{ t('inspector.transformNode.labels.outputColumns') }}</label>
        <div class="tags-editor">
          <div v-for="(col, index) in outputColumns" :key="index" class="tag-item">
            <input
              v-model="outputColumns[index]"
              class="tag-input"
              @blur="commitOutputColumns"
              @keydown.enter="commitOutputColumns"
            />
            <button class="tag-remove" @click="removeOutputColumn(index)">×</button>
          </div>
          <input
            v-model="newColumnName"
            class="tag-input tag-new"
            :placeholder="t('inspector.transformNode.placeholders.addColumn')"
            @keydown.enter="addOutputColumn"
          />
        </div>
      </div>
    </BaseInspector>

    <!-- 3. 参数 -->
    <BaseInspector
      :title="t('inspector.transformNode.groups.params')"
      :badge="t('inspector.transformNode.badgeEditable')"
      badge-class="editable"
    >
      <!-- StringSplit 专用表单 -->
      <template v-if="data.transformType === 'StringSplit'">
        <div class="form-group">
          <label>分隔符</label>
          <input
            class="tag-input"
            :value="(data.params?.delimiter as string) ?? ','"
            placeholder="例如 , 或 - 或 空格"
            @change="updateParam('delimiter', ($event.target as HTMLInputElement).value)"
          />
        </div>
        <div class="form-group">
          <label>最大分割次数</label>
          <input
            type="number"
            class="tag-input"
            :value="(data.params?.maxsplit as number) ?? -1"
            @change="
              updateParam('maxsplit', parseInt(($event.target as HTMLInputElement).value || '-1'))
            "
          />
          <span class="field-hint">-1 表示分割所有出现的分隔符</span>
        </div>
      </template>

      <!-- MathExpr 专用表单 -->
      <template v-else-if="data.transformType === 'MathExpr'">
        <div class="form-group">
          <label>数学表达式</label>
          <input
            class="tag-input"
            style="width: 100%"
            :value="(data.params?.expression as string) ?? ''"
            placeholder="例如: @col_name * 2 + 10"
            @change="updateParam('expression', ($event.target as HTMLInputElement).value)"
          />
          <span class="field-hint">使用 @列名 引用输入列，支持 + - * / ** 等运算符</span>
        </div>
        <div class="form-group">
          <label>输出类型</label>
          <select
            class="tag-input"
            style="width: 100%; background: var(--ui-bg-elevated)"
            :value="(data.params?.output_type as string) ?? ''"
            @change="updateParam('output_type', ($event.target as HTMLSelectElement).value)"
          >
            <option value="">自动推断</option>
            <option value="int">整数 (int)</option>
            <option value="float">浮点数 (float)</option>
          </select>
        </div>
      </template>

      <!-- RegexExtract 专用表单 -->
      <template v-else-if="data.transformType === 'RegexExtract'">
        <div class="form-group">
          <label>正则表达式</label>
          <input
            class="tag-input"
            style="width: 100%"
            :value="(data.params?.pattern as string) ?? ''"
            placeholder="例如: (\d{4})-(\d{2})-(\d{2})"
            @change="handleRegexPatternChange(($event.target as HTMLInputElement).value)"
          />
          <span class="field-hint">
            使用捕获组 () 提取内容，下方会自动显示捕获组数量并配置输出列名
          </span>
        </div>
        <div class="form-group form-group-row">
          <label>忽略大小写</label>
          <input
            type="checkbox"
            :checked="(data.params?.flags as string) === 'i'"
            @change="updateParam('flags', ($event.target as HTMLInputElement).checked ? 'i' : '')"
          />
        </div>
        <!-- 捕获组配置 -->
        <div v-if="regexCaptureGroupCount > 0" class="form-group">
          <label>捕获组配置（{{ regexCaptureGroupCount }} 个）</label>
          <div class="capture-groups-list">
            <div v-for="(groupName, idx) in regexGroupNames" :key="idx" class="capture-group-item">
              <span class="capture-group-label">组{{ idx + 1 }}</span>
              <input
                v-model="regexGroupNames[idx]"
                class="tag-input capture-group-input"
                :placeholder="`列名${idx + 1}`"
                @blur="commitRegexGroupNames"
                @keydown.enter="commitRegexGroupNames"
              />
            </div>
          </div>
        </div>
        <div v-else-if="(data.params?.pattern as string)?.length > 0" class="form-group">
          <span class="field-hint" style="color: var(--ui-text-muted)">
            未检测到捕获组，请用 () 包裹要提取的内容
          </span>
        </div>
      </template>

      <!-- DateFormat 专用表单 -->
      <template v-else-if="data.transformType === 'DateFormat'">
        <div class="form-group">
          <label>输入日期格式</label>
          <input
            class="tag-input"
            style="width: 100%"
            :value="(data.params?.input_format as string) ?? '%Y-%m-%d'"
            placeholder="例如: %Y-%m-%d"
            @change="updateParam('input_format', ($event.target as HTMLInputElement).value)"
          />
          <span class="field-hint">%Y=年 %m=月 %d=日 %H=时 %M=分 %S=秒</span>
        </div>
        <div class="form-group">
          <label>输出日期格式</label>
          <input
            class="tag-input"
            style="width: 100%"
            :value="(data.params?.output_format as string) ?? '%Y/%m/%d'"
            placeholder="例如: %Y/%m/%d"
            @change="updateParam('output_format', ($event.target as HTMLInputElement).value)"
          />
        </div>
        <div class="form-group">
          <label>错误处理策略</label>
          <select
            class="tag-input"
            style="width: 100%; background: var(--ui-bg-elevated)"
            :value="(data.params?.errors as string) ?? 'coerce'"
            @change="updateParam('errors', ($event.target as HTMLSelectElement).value)"
          >
            <option value="coerce">转为空值 (coerce)</option>
            <option value="raise">抛出异常 (raise)</option>
            <option value="ignore">保留原值 (ignore)</option>
          </select>
        </div>
      </template>

      <!-- Lookup 专用表单 -->
      <template v-else-if="data.transformType === 'Lookup'">
        <div class="form-group">
          <label>映射表 (JSON)</label>
          <textarea
            v-model="lookupText"
            class="params-textarea"
            rows="4"
            placeholder='例如: {"A": "优秀", "B": "良好", "C": "及格"}'
            @blur="commitLookup"
          />
          <div v-if="lookupError" class="params-error">{{ lookupError }}</div>
          <span class="field-hint">键为原值，值为替换后的新值</span>
        </div>
        <div class="form-group">
          <label>未匹配默认值</label>
          <input
            class="tag-input"
            style="width: 100%"
            :value="(data.params?.default as string) ?? ''"
            placeholder="未匹配时填充的值（留空则保持原值）"
            @change="updateParam('default', ($event.target as HTMLInputElement).value)"
          />
        </div>
      </template>

      <!-- Strip 专用表单 -->
      <template v-else-if="data.transformType === 'Strip'">
        <div class="form-group">
          <label>要去除的字符</label>
          <input
            class="tag-input"
            style="width: 100%"
            :value="(data.params?.chars as string) ?? ''"
            placeholder="留空表示去除所有空白字符"
            @change="updateParam('chars', ($event.target as HTMLInputElement).value || null)"
          />
          <span class="field-hint">留空去除首尾空白；填写则去除指定的字符集合</span>
        </div>
      </template>

      <!-- UpperCase / LowerCase 专用表单 -->
      <template
        v-else-if="data.transformType === 'UpperCase' || data.transformType === 'LowerCase'"
      >
        <div class="form-group">
          <span class="field-hint">无需额外参数，直接转换大小写</span>
        </div>
      </template>

      <!-- Replace 专用表单 -->
      <template v-else-if="data.transformType === 'Replace'">
        <div class="form-group">
          <label>查找内容</label>
          <input
            class="tag-input"
            style="width: 100%"
            :value="(data.params?.old as string) ?? ''"
            placeholder="要被替换的文本"
            @change="updateParam('old', ($event.target as HTMLInputElement).value)"
          />
        </div>
        <div class="form-group">
          <label>替换为</label>
          <input
            class="tag-input"
            style="width: 100%"
            :value="(data.params?.new as string) ?? ''"
            placeholder="新的文本内容"
            @change="updateParam('new', ($event.target as HTMLInputElement).value)"
          />
        </div>
        <div class="form-group">
          <label>最大替换次数</label>
          <input
            type="number"
            class="tag-input"
            :value="(data.params?.count as number) ?? -1"
            @change="
              updateParam('count', parseInt(($event.target as HTMLInputElement).value || '-1'))
            "
          />
          <span class="field-hint">-1 表示替换所有出现的位置</span>
        </div>
      </template>

      <!-- FilterRows 专用表单 -->
      <template v-else-if="data.transformType === 'FilterRows'">
        <div class="form-group">
          <label>过滤条件</label>
          <div v-for="(cond, idx) in filterConditions" :key="idx" class="condition-row">
            <input
              class="tag-input cond-col"
              :value="cond.column || ''"
              placeholder="列名"
              @change="
                updateFilterCondition(idx, 'column', ($event.target as HTMLInputElement).value)
              "
            />
            <select
              class="tag-input cond-op"
              style="background: var(--ui-bg-elevated)"
              :value="cond.op || 'eq'"
              @change="updateFilterCondition(idx, 'op', ($event.target as HTMLSelectElement).value)"
            >
              <option value="eq">=</option>
              <option value="ne">≠</option>
              <option value="gt">&gt;</option>
              <option value="gte">≥</option>
              <option value="lt">&lt;</option>
              <option value="lte">≤</option>
              <option value="contains">包含</option>
              <option value="startsWith">开头</option>
              <option value="endsWith">结尾</option>
              <option value="regex">正则</option>
              <option value="in">在列表中</option>
            </select>
            <input
              class="tag-input cond-val"
              :value="cond.value ?? ''"
              placeholder="值"
              @change="
                updateFilterCondition(idx, 'value', ($event.target as HTMLInputElement).value)
              "
            />
            <button class="cond-remove" @click="removeFilterCondition(idx)">×</button>
          </div>
          <button class="add-cond-btn" @click="addFilterCondition">+ 添加条件</button>
        </div>
        <div class="form-group form-group-row">
          <label>条件逻辑</label>
          <select
            class="tag-input"
            style="background: var(--ui-bg-elevated)"
            :value="(data.params?.logic as string) ?? 'and'"
            @change="updateParam('logic', ($event.target as HTMLSelectElement).value)"
          >
            <option value="and">全部满足 (AND)</option>
            <option value="or">任一满足 (OR)</option>
          </select>
        </div>
      </template>

      <!-- FillNA 专用表单 -->
      <template v-else-if="data.transformType === 'FillNA'">
        <div class="form-group">
          <label>填充策略</label>
          <select
            class="tag-input"
            style="width: 100%; background: var(--ui-bg-elevated)"
            :value="(data.params?.strategy as string) ?? 'value'"
            @change="updateParam('strategy', ($event.target as HTMLSelectElement).value)"
          >
            <option value="value">指定值</option>
            <option value="ffill">前向填充</option>
            <option value="bfill">后向填充</option>
            <option value="mean">均值</option>
            <option value="median">中位数</option>
          </select>
        </div>
        <div
          v-if="(data.params?.strategy as string) === 'value' || !data.params?.strategy"
          class="form-group"
        >
          <label>填充值</label>
          <input
            class="tag-input"
            style="width: 100%"
            :value="(data.params?.fill_value as string) ?? ''"
            placeholder="用于替换空值的文本"
            @change="updateParam('fill_value', ($event.target as HTMLInputElement).value)"
          />
        </div>
      </template>

      <!-- DropDuplicates 专用表单 -->
      <template v-else-if="data.transformType === 'DropDuplicates'">
        <div class="form-group">
          <label>去重列（可选）</label>
          <input
            class="tag-input"
            style="width: 100%"
            :value="(data.params?.subset as string) ?? ''"
            placeholder="留空表示按全部列去重；多列用逗号分隔"
            @change="updateParam('subset', ($event.target as HTMLInputElement).value)"
          />
          <span class="field-hint">例如: id,name 表示按这两列组合去重</span>
        </div>
        <div class="form-group">
          <label>保留策略</label>
          <select
            class="tag-input"
            style="width: 100%; background: var(--ui-bg-elevated)"
            :value="String((data.params?.keep as string) ?? 'first')"
            @change="updateParam('keep', ($event.target as HTMLSelectElement).value)"
          >
            <option value="first">保留第一条</option>
            <option value="last">保留最后一条</option>
            <option value="false">全部删除</option>
          </select>
        </div>
      </template>

      <!-- CastType 专用表单 -->
      <template v-else-if="data.transformType === 'CastType'">
        <div class="form-group">
          <label>目标类型</label>
          <select
            class="tag-input"
            style="width: 100%; background: var(--ui-bg-elevated)"
            :value="(data.params?.target_type as string) ?? 'string'"
            @change="updateParam('target_type', ($event.target as HTMLSelectElement).value)"
          >
            <option value="string">字符串 (string)</option>
            <option value="int">整数 (int)</option>
            <option value="float">浮点数 (float)</option>
            <option value="bool">布尔值 (bool)</option>
            <option value="datetime">日期时间 (datetime)</option>
          </select>
        </div>
        <div v-if="(data.params?.target_type as string) === 'datetime'" class="form-group">
          <label>输入日期格式</label>
          <input
            class="tag-input"
            style="width: 100%"
            :value="(data.params?.format as string) ?? '%Y-%m-%d'"
            placeholder="例如: %Y-%m-%d"
            @change="updateParam('format', ($event.target as HTMLInputElement).value)"
          />
          <span class="field-hint">%Y=年 %m=月 %d=日 %H=时 %M=分 %S=秒</span>
        </div>
        <div class="form-group">
          <label>错误处理</label>
          <select
            class="tag-input"
            style="width: 100%; background: var(--ui-bg-elevated)"
            :value="(data.params?.errors as string) ?? 'coerce'"
            @change="updateParam('errors', ($event.target as HTMLSelectElement).value)"
          >
            <option value="coerce">转为空值 (coerce)</option>
            <option value="raise">抛出异常 (raise)</option>
            <option value="ignore">保留原值 (ignore)</option>
          </select>
        </div>
      </template>

      <!-- Concat 专用表单 -->
      <template v-else-if="data.transformType === 'Concat'">
        <div class="form-group">
          <label>要拼接的列</label>
          <input
            class="tag-input"
            style="width: 100%"
            :value="(data.params?.columns as string) ?? ''"
            placeholder="列名用逗号分隔，例如: first_name,last_name"
            @change="updateParam('columns', ($event.target as HTMLInputElement).value)"
          />
        </div>
        <div class="form-group">
          <label>分隔符</label>
          <input
            class="tag-input"
            style="width: 100%"
            :value="(data.params?.separator as string) ?? ''"
            placeholder="例如: 空格、-、/"
            @change="updateParam('separator', ($event.target as HTMLInputElement).value)"
          />
          <span class="field-hint">留空表示直接拼接</span>
        </div>
        <div class="form-group">
          <label>输出列名</label>
          <input
            class="tag-input"
            style="width: 100%"
            :value="(data.params?.output_column as string) ?? ''"
            placeholder="新列的名称"
            @change="updateParam('output_column', ($event.target as HTMLInputElement).value)"
          />
        </div>
      </template>

      <!-- Substring 专用表单 -->
      <template v-else-if="data.transformType === 'Substring'">
        <div class="form-group">
          <label>起始位置</label>
          <input
            type="number"
            class="tag-input"
            :value="(data.params?.start as number) ?? 0"
            @change="
              updateParam('start', parseInt(($event.target as HTMLInputElement).value || '0'))
            "
          />
          <span class="field-hint">从 0 开始计数，负数表示从末尾倒数</span>
        </div>
        <div class="form-group">
          <label>结束位置（可选）</label>
          <input
            type="number"
            class="tag-input"
            :value="(data.params?.end as number) ?? ''"
            placeholder="留空表示截取到末尾"
            @change="
              updateParam(
                'end',
                ($event.target as HTMLInputElement).value === ''
                  ? null
                  : parseInt(($event.target as HTMLInputElement).value)
              )
            "
          />
        </div>
        <div class="form-group">
          <label>长度（可选）</label>
          <input
            type="number"
            class="tag-input"
            :value="(data.params?.length as number) ?? ''"
            placeholder="留空表示由起始/结束位置决定"
            @change="
              updateParam(
                'length',
                ($event.target as HTMLInputElement).value === ''
                  ? null
                  : parseInt(($event.target as HTMLInputElement).value)
              )
            "
          />
        </div>
      </template>

      <!-- Aggregate 专用表单 -->
      <template v-else-if="data.transformType === 'Aggregate'">
        <div class="form-group">
          <label>分组列</label>
          <input
            class="tag-input"
            style="width: 100%"
            :value="(data.params?.group_by as string) ?? ''"
            placeholder="列名用逗号分隔，例如: category,region"
            @change="updateParam('group_by', ($event.target as HTMLInputElement).value)"
          />
          <span class="field-hint">留空表示对整张表聚合（不分组）</span>
        </div>
        <div class="form-group">
          <label>聚合配置</label>
          <div v-for="(agg, idx) in aggregateConfigs" :key="idx" class="condition-row">
            <input
              class="tag-input cond-col"
              :value="agg.column || ''"
              placeholder="列名"
              @change="
                updateAggregateConfig(idx, 'column', ($event.target as HTMLInputElement).value)
              "
            />
            <select
              class="tag-input cond-op"
              style="background: var(--ui-bg-elevated)"
              :value="agg.func || 'count'"
              @change="
                updateAggregateConfig(idx, 'func', ($event.target as HTMLSelectElement).value)
              "
            >
              <option value="count">计数</option>
              <option value="sum">求和</option>
              <option value="avg">平均值</option>
              <option value="min">最小值</option>
              <option value="max">最大值</option>
            </select>
            <button class="cond-remove" @click="removeAggregateConfig(idx)">×</button>
          </div>
          <button class="add-cond-btn" @click="addAggregateConfig">+ 添加聚合</button>
        </div>
      </template>

      <!-- ConditionalAssign 专用表单 -->
      <template v-else-if="data.transformType === 'ConditionalAssign'">
        <div class="form-group">
          <label>条件</label>
          <div v-for="(cond, idx) in conditionalConditions" :key="idx" class="condition-row">
            <input
              class="tag-input cond-col"
              :value="cond.column || ''"
              placeholder="列名"
              @change="
                updateConditionalCondition(idx, 'column', ($event.target as HTMLInputElement).value)
              "
            />
            <select
              class="tag-input cond-op"
              style="background: var(--ui-bg-elevated)"
              :value="cond.op || 'eq'"
              @change="
                updateConditionalCondition(idx, 'op', ($event.target as HTMLSelectElement).value)
              "
            >
              <option value="eq">=</option>
              <option value="ne">≠</option>
              <option value="gt">&gt;</option>
              <option value="gte">≥</option>
              <option value="lt">&lt;</option>
              <option value="lte">≤</option>
              <option value="contains">包含</option>
              <option value="startsWith">开头</option>
              <option value="endsWith">结尾</option>
              <option value="regex">正则</option>
              <option value="in">在列表中</option>
            </select>
            <input
              class="tag-input cond-val"
              :value="cond.value ?? ''"
              placeholder="值"
              @change="
                updateConditionalCondition(idx, 'value', ($event.target as HTMLInputElement).value)
              "
            />
            <button class="cond-remove" @click="removeConditionalCondition(idx)">×</button>
          </div>
          <button class="add-cond-btn" @click="addConditionalCondition">+ 添加条件</button>
        </div>
        <div class="form-group form-group-row">
          <label>条件逻辑</label>
          <select
            class="tag-input"
            style="background: var(--ui-bg-elevated)"
            :value="(data.params?.logic as string) ?? 'and'"
            @change="updateParam('logic', ($event.target as HTMLSelectElement).value)"
          >
            <option value="and">全部满足 (AND)</option>
            <option value="or">任一满足 (OR)</option>
          </select>
        </div>
        <div class="form-group">
          <label>满足条件时的值</label>
          <input
            class="tag-input"
            style="width: 100%"
            :value="(data.params?.then_value as string) ?? ''"
            placeholder="条件满足时填充的值"
            @change="updateParam('then_value', ($event.target as HTMLInputElement).value)"
          />
        </div>
        <div class="form-group">
          <label>不满足条件时的值（可选）</label>
          <input
            class="tag-input"
            style="width: 100%"
            :value="(data.params?.else_value as string) ?? ''"
            placeholder="条件不满足时填充的值（留空则保持原值）"
            @change="updateParam('else_value', ($event.target as HTMLInputElement).value)"
          />
        </div>
      </template>

      <!-- SortRows 专用表单 -->
      <template v-else-if="data.transformType === 'SortRows'">
        <div class="form-group">
          <label>排序规则</label>
          <div v-for="(sort, idx) in sortConfigs" :key="idx" class="condition-row">
            <input
              class="tag-input cond-col"
              :value="sort.column || ''"
              placeholder="列名"
              @change="updateSortConfig(idx, 'column', ($event.target as HTMLInputElement).value)"
            />
            <select
              class="tag-input cond-op"
              style="background: var(--ui-bg-elevated)"
              :value="sort.order || 'asc'"
              @change="updateSortConfig(idx, 'order', ($event.target as HTMLSelectElement).value)"
            >
              <option value="asc">升序 (A→Z)</option>
              <option value="desc">降序 (Z→A)</option>
            </select>
            <button class="cond-remove" @click="removeSortConfig(idx)">×</button>
          </div>
          <button class="add-cond-btn" @click="addSortConfig">+ 添加排序列</button>
        </div>
      </template>

      <!-- Digits：逐位分解 -->
      <template v-else-if="data.transformType === 'Digits'">
        <div class="form-group">
          <span class="field-hint">将字符串逐字符拆分为多行，无需额外参数</span>
        </div>
      </template>

      <!-- WeightedSum：加权求和 -->
      <template v-else-if="data.transformType === 'WeightedSum'">
        <div class="form-group">
          <label>权重数组 (JSON 数字数组)</label>
          <textarea
            v-model="weightsText"
            class="params-textarea"
            rows="3"
            placeholder="例如: [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]"
            @blur="commitWeights"
          />
          <div v-if="weightsError" class="params-error">{{ weightsError }}</div>
          <span class="field-hint">与上游行数一一对应相乘后求和，输出单行结果</span>
        </div>
      </template>

      <!-- Modulo：取模 -->
      <template v-else-if="data.transformType === 'Modulo'">
        <div class="form-group">
          <label>除数 (模数)</label>
          <input
            type="number"
            class="tag-input"
            style="width: 100%"
            :value="(data.params?.divisor as number) ?? 1"
            placeholder="例如: 11"
            @change="
              updateParam('divisor', parseFloat(($event.target as HTMLInputElement).value) || 1)
            "
          />
        </div>
      </template>

      <!-- MapValue：查表映射 -->
      <template v-else-if="data.transformType === 'MapValue'">
        <div class="form-group">
          <label>映射表 (JSON 数组)</label>
          <textarea
            v-model="mappingText"
            class="params-textarea"
            rows="4"
            placeholder='例如: [1, 0, "X", 9, 8, 7, 6, 5, 4, 3, 2]'
            @blur="commitMapping"
          />
          <div v-if="mappingError" class="params-error">{{ mappingError }}</div>
          <span class="field-hint">以上游值作为索引取对应元素，索引越界时保留原值</span>
        </div>
      </template>

      <!-- 其他类型：通用 JSON 编辑器 -->
      <template v-else>
        <div class="form-group">
          <label>{{ t('inspector.transformNode.labels.params') }}</label>
          <textarea v-model="paramsText" class="params-textarea" rows="6" @blur="commitParams" />
          <div v-if="paramsError" class="params-error">{{ paramsError }}</div>
        </div>
      </template>
    </BaseInspector>

    <!-- 4. 选项 -->
    <BaseInspector
      :title="t('inspector.transformNode.groups.options')"
      :badge="t('inspector.transformNode.badgeEditable')"
      badge-class="editable"
    >
      <div class="form-group form-group-row">
        <label>{{ t('inspector.transformNode.labels.enabled') }}</label>
        <input
          type="checkbox"
          :checked="data.enabled"
          @change="emitUpdate('enabled', ($event.target as HTMLInputElement).checked)"
        />
      </div>
    </BaseInspector>

    <!-- 5. 状态 -->
    <BaseInspector
      :title="t('inspector.transformNode.groups.status')"
      :badge="t('inspector.transformNode.badgeReadOnly')"
      badge-class="read-only"
    >
      <InspectorField
        :label="t('inspector.transformNode.labels.saveState')"
        :model-value="data.saveState || 'draft'"
        :editable="false"
      />
    </BaseInspector>
  </div>
</template>

<script setup lang="ts">
  import { computed, ref, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import BaseInspector from './BaseInspector.vue'
  import { InspectorField } from '@/components/ui/inspector'
  import type { TransformNodeData } from '@/types/nodes'

  const { t } = useI18n()

  interface Props {
    data: TransformNodeData
    nodeId: string
    nodeType: string
  }

  const props = defineProps<Props>()
  const emit = defineEmits<{
    'update:data': [value: Partial<TransformNodeData>]
  }>()

  const typeDisplay = computed(() => {
    const keyMap: Record<string, string> = {
      StringSplit: 'customNodes.transformNode.types.stringSplit',
      RegexExtract: 'customNodes.transformNode.types.regexExtract',
      MathExpr: 'customNodes.transformNode.types.mathExpr',
      DateFormat: 'customNodes.transformNode.types.dateFormat',
      Lookup: 'customNodes.transformNode.types.lookup',
      Strip: 'customNodes.transformNode.types.strip',
      UpperCase: 'customNodes.transformNode.types.upperCase',
      LowerCase: 'customNodes.transformNode.types.lowerCase',
      Replace: 'customNodes.transformNode.types.replace',
      FilterRows: 'customNodes.transformNode.types.filterRows',
      FillNA: 'customNodes.transformNode.types.fillNA',
      DropDuplicates: 'customNodes.transformNode.types.dropDuplicates',
      CastType: 'customNodes.transformNode.types.castType',
      Concat: 'customNodes.transformNode.types.concat',
      Substring: 'customNodes.transformNode.types.substring',
      Aggregate: 'customNodes.transformNode.types.aggregate',
      ConditionalAssign: 'customNodes.transformNode.types.conditionalAssign',
      SortRows: 'customNodes.transformNode.types.sortRows',
      Digits: 'customNodes.transformNode.types.digits',
      WeightedSum: 'customNodes.transformNode.types.weightedSum',
      Modulo: 'customNodes.transformNode.types.modulo',
      MapValue: 'customNodes.transformNode.types.mapValue',
    }
    const key = keyMap[props.data.transformType]
    return key ? t(key) : props.data.transformType
  })

  const outputColumns = ref<string[]>([...(props.data.outputColumns || [])])
  watch(
    () => props.data.outputColumns,
    (cols) => {
      outputColumns.value = [...(cols || [])]
    },
    { deep: true }
  )

  const newColumnName = ref('')

  function addOutputColumn() {
    const name = newColumnName.value.trim()
    if (!name) return
    if (!outputColumns.value.includes(name)) {
      outputColumns.value.push(name)
      commitOutputColumns()
    }
    newColumnName.value = ''
  }

  function removeOutputColumn(index: number) {
    outputColumns.value.splice(index, 1)
    commitOutputColumns()
  }

  function commitOutputColumns() {
    emitUpdate('outputColumns', outputColumns.value.filter(Boolean))
  }

  const paramsText = ref(JSON.stringify(props.data.params || {}, null, 2))
  const paramsError = ref('')

  watch(
    () => props.data.params,
    (p) => {
      try {
        paramsText.value = JSON.stringify(p || {}, null, 2)
        paramsError.value = ''
      } catch {
        paramsText.value = String(p)
      }
    },
    { deep: true }
  )

  function commitParams() {
    try {
      const parsed = JSON.parse(paramsText.value)
      paramsError.value = ''
      emitUpdate('params', parsed)
    } catch (e) {
      paramsError.value = t('inspector.transformNode.errors.invalidJson')
    }
  }

  // ============================================================================
  // WeightedSum 权重数组编辑
  // ============================================================================

  const weightsText = ref(JSON.stringify((props.data.params?.weights as number[]) || [], null, 2))
  const weightsError = ref('')

  watch(
    () => props.data.params?.weights,
    (w) => {
      try {
        weightsText.value = JSON.stringify((w as number[]) || [], null, 2)
        weightsError.value = ''
      } catch {
        weightsText.value = String(w)
      }
    },
    { deep: true }
  )

  function commitWeights() {
    try {
      const parsed = JSON.parse(weightsText.value)
      if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === 'number')) {
        weightsError.value = '权重数组必须是数字数组'
        return
      }
      weightsError.value = ''
      updateParam('weights', parsed)
    } catch {
      weightsError.value = t('inspector.transformNode.errors.invalidJson')
    }
  }

  // ============================================================================
  // MapValue 映射表编辑
  // ============================================================================

  const mappingText = ref(
    JSON.stringify((props.data.params?.mapping as Array<string | number>) || [], null, 2)
  )
  const mappingError = ref('')

  watch(
    () => props.data.params?.mapping,
    (m) => {
      try {
        mappingText.value = JSON.stringify((m as Array<string | number>) || [], null, 2)
        mappingError.value = ''
      } catch {
        mappingText.value = String(m)
      }
    },
    { deep: true }
  )

  function commitMapping() {
    try {
      const parsed = JSON.parse(mappingText.value)
      if (!Array.isArray(parsed)) {
        mappingError.value = '映射表必须是数组'
        return
      }
      mappingError.value = ''
      updateParam('mapping', parsed)
    } catch {
      mappingError.value = t('inspector.transformNode.errors.invalidJson')
    }
  }

  function emitUpdate<K extends keyof TransformNodeData>(key: K, value: TransformNodeData[K]) {
    emit('update:data', { [key]: value } as Partial<TransformNodeData>)
  }

  function updateParam(key: string, value: unknown) {
    const nextParams = { ...(props.data.params || {}), [key]: value }
    emitUpdate('params', nextParams)
  }

  // ============================================================================
  // RegexExtract 捕获组解析与配置
  // ============================================================================

  /**
   * 解析正则表达式中的捕获组数量
   * 排除：非捕获组 (?:...)、断言 (?=...)、命名捕获组 (?P<...>)、字符类中的 (、转义的 \(
   */
  function countCaptureGroups(pattern: string): number {
    if (!pattern) return 0
    let count = 0
    let inCharClass = false
    let escaped = false
    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i]
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\') {
        escaped = true
        continue
      }
      if (ch === '[' && !inCharClass) {
        inCharClass = true
        continue
      }
      if (ch === ']' && inCharClass) {
        inCharClass = false
        continue
      }
      if (inCharClass) continue
      if (ch === '(' && pattern[i + 1] !== '?') {
        count++
      }
    }
    return count
  }

  const regexCaptureGroupCount = computed(() =>
    countCaptureGroups((props.data.params?.pattern as string) || '')
  )

  // 捕获组列名编辑状态（与 outputColumns 同步）
  const regexGroupNames = ref<string[]>([...(props.data.outputColumns || [])])
  watch(
    () => props.data.outputColumns,
    (cols) => {
      regexGroupNames.value = [...(cols || [])]
    },
    { deep: true }
  )

  // 当正则表达式的捕获组数量变化时，自动补全默认列名
  function handleRegexPatternChange(pattern: string) {
    updateParam('pattern', pattern)
    const groupCount = countCaptureGroups(pattern)
    const currentCols = [...(props.data.outputColumns || [])]
    // 如果当前列名数量不足，自动填充默认列名
    if (groupCount > 0 && currentCols.length < groupCount) {
      const nextCols = [...currentCols]
      for (let i = currentCols.length; i < groupCount; i++) {
        nextCols.push(`extract_${i + 1}`)
      }
      emitUpdate('outputColumns', nextCols)
    }
  }

  function commitRegexGroupNames() {
    const names = regexGroupNames.value.map((n) => n.trim()).filter(Boolean)
    // 保持与捕获组数量一致，空位用默认名填充
    const groupCount = regexCaptureGroupCount.value
    const nextCols: string[] = []
    for (let i = 0; i < groupCount; i++) {
      nextCols.push(names[i] || `extract_${i + 1}`)
    }
    emitUpdate('outputColumns', nextCols)
  }

  // Lookup 映射表专用编辑状态
  const lookupText = ref(
    JSON.stringify((props.data.params as Record<string, unknown>)?.mapping || {}, null, 2)
  )
  const lookupError = ref('')

  watch(
    () => props.data.params,
    (p) => {
      try {
        lookupText.value = JSON.stringify((p as Record<string, unknown>)?.mapping || {}, null, 2)
        lookupError.value = ''
      } catch {
        lookupText.value = String((p as Record<string, unknown>)?.mapping || {})
      }
    },
    { deep: true }
  )

  function commitLookup() {
    try {
      const parsed = JSON.parse(lookupText.value)
      lookupError.value = ''
      const nextParams = { ...(props.data.params || {}), mapping: parsed }
      emitUpdate('params', nextParams)
    } catch (e) {
      lookupError.value = t('inspector.transformNode.errors.invalidJson')
    }
  }

  // ============================================================================
  // FilterRows 条件列表辅助函数
  // ============================================================================

  interface FilterCondition {
    column: string
    op: string
    value: string
  }

  const filterConditions = computed<FilterCondition[]>({
    get: () => {
      const conds = props.data.params?.conditions as FilterCondition[] | undefined
      return conds && conds.length > 0 ? conds : [{ column: '', op: 'eq', value: '' }]
    },
    set: (val) => {
      updateParam(
        'conditions',
        val.filter((c) => c.column || c.value)
      )
    },
  })

  function updateFilterCondition(index: number, key: keyof FilterCondition, value: string) {
    const next = [...filterConditions.value]
    next[index] = { ...next[index], [key]: value }
    filterConditions.value = next
  }

  function addFilterCondition() {
    filterConditions.value = [...filterConditions.value, { column: '', op: 'eq', value: '' }]
  }

  function removeFilterCondition(index: number) {
    const next = [...filterConditions.value]
    next.splice(index, 1)
    filterConditions.value = next.length > 0 ? next : [{ column: '', op: 'eq', value: '' }]
  }

  // ============================================================================
  // Aggregate 聚合配置辅助函数
  // ============================================================================

  interface AggregateConfig {
    column: string
    func: string
  }

  const aggregateConfigs = computed<AggregateConfig[]>({
    get: () => {
      const aggs = props.data.params?.aggregations as AggregateConfig[] | undefined
      return aggs && aggs.length > 0 ? aggs : [{ column: '', func: 'count' }]
    },
    set: (val) => {
      updateParam(
        'aggregations',
        val.filter((a) => a.column)
      )
    },
  })

  function updateAggregateConfig(index: number, key: keyof AggregateConfig, value: string) {
    const next = [...aggregateConfigs.value]
    next[index] = { ...next[index], [key]: value }
    aggregateConfigs.value = next
  }

  function addAggregateConfig() {
    aggregateConfigs.value = [...aggregateConfigs.value, { column: '', func: 'count' }]
  }

  function removeAggregateConfig(index: number) {
    const next = [...aggregateConfigs.value]
    next.splice(index, 1)
    aggregateConfigs.value = next.length > 0 ? next : [{ column: '', func: 'count' }]
  }

  // ============================================================================
  // ConditionalAssign 条件列表辅助函数
  // ============================================================================

  const conditionalConditions = computed<FilterCondition[]>({
    get: () => {
      const conds = props.data.params?.conditions as FilterCondition[] | undefined
      return conds && conds.length > 0 ? conds : [{ column: '', op: 'eq', value: '' }]
    },
    set: (val) => {
      updateParam(
        'conditions',
        val.filter((c) => c.column || c.value)
      )
    },
  })

  function updateConditionalCondition(index: number, key: keyof FilterCondition, value: string) {
    const next = [...conditionalConditions.value]
    next[index] = { ...next[index], [key]: value }
    conditionalConditions.value = next
  }

  function addConditionalCondition() {
    conditionalConditions.value = [
      ...conditionalConditions.value,
      { column: '', op: 'eq', value: '' },
    ]
  }

  function removeConditionalCondition(index: number) {
    const next = [...conditionalConditions.value]
    next.splice(index, 1)
    conditionalConditions.value = next.length > 0 ? next : [{ column: '', op: 'eq', value: '' }]
  }

  // ============================================================================
  // SortRows 排序配置辅助函数
  // ============================================================================

  interface SortConfig {
    column: string
    order: string
  }

  const sortConfigs = computed<SortConfig[]>({
    get: () => {
      const sorts = props.data.params?.sort_by as SortConfig[] | undefined
      return sorts && sorts.length > 0 ? sorts : [{ column: '', order: 'asc' }]
    },
    set: (val) => {
      updateParam(
        'sort_by',
        val.filter((s) => s.column)
      )
    },
  })

  function updateSortConfig(index: number, key: keyof SortConfig, value: string) {
    const next = [...sortConfigs.value]
    next[index] = { ...next[index], [key]: value }
    sortConfigs.value = next
  }

  function addSortConfig() {
    sortConfigs.value = [...sortConfigs.value, { column: '', order: 'asc' }]
  }

  function removeSortConfig(index: number) {
    const next = [...sortConfigs.value]
    next.splice(index, 1)
    sortConfigs.value = next.length > 0 ? next : [{ column: '', order: 'asc' }]
  }
</script>

<style scoped>
  .transform-inspector {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 8px;
  }

  .form-group-row {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }

  .form-group label {
    font-size: 12px;
    color: var(--ui-text-muted);
  }

  .tags-editor {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .tag-item {
    display: flex;
    align-items: center;
    gap: 2px;
    background: var(--ui-bg-elevated);
    border: 1px solid var(--ui-border-subtle);
    border-radius: 4px;
    padding: 2px 4px;
  }

  .tag-input {
    background: transparent;
    border: none;
    color: var(--ui-text-primary);
    font-size: 12px;
    outline: none;
    width: 80px;
  }

  .tag-new {
    width: 120px;
    background: var(--ui-bg-elevated);
    border: 1px dashed var(--ui-border-light);
    border-radius: 4px;
    padding: 2px 6px;
  }

  .tag-remove {
    background: none;
    border: none;
    color: var(--ui-text-muted);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0 2px;
  }

  .tag-remove:hover {
    color: #f44336;
  }

  .params-textarea {
    width: 100%;
    background: var(--ui-bg-elevated);
    border: 1px solid var(--ui-border-subtle);
    border-radius: 4px;
    padding: 8px;
    color: var(--ui-text-primary);
    font-family: 'Consolas', 'Monaco', monospace;
    font-size: 12px;
    resize: vertical;
    outline: none;
  }

  .params-error {
    color: #f44336;
    font-size: 11px;
  }

  .field-hint {
    font-size: 11px;
    color: var(--ui-text-muted);
    margin-top: 2px;
  }

  /* ============================================================================
     RegexExtract 捕获组配置
     ============================================================================ */

  .capture-groups-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .capture-group-item {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--ui-bg-elevated);
    border: 1px solid var(--ui-border-subtle);
    border-radius: 4px;
    padding: 4px 8px;
  }

  .capture-group-label {
    font-size: 11px;
    color: var(--ui-text-muted);
    min-width: 32px;
    flex-shrink: 0;
  }

  .capture-group-input {
    flex: 1;
    min-width: 60px;
  }

  /* ============================================================================
     条件行编辑器（FilterRows / Aggregate / ConditionalAssign / SortRows）
     ============================================================================ */

  .condition-row {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 4px;
  }

  .condition-row .cond-col {
    flex: 1;
    min-width: 50px;
  }

  .condition-row .cond-op {
    flex: 0 0 80px;
    padding: 2px 4px;
    border-radius: 3px;
    border: 1px solid var(--ui-border-subtle);
    background: var(--ui-bg-elevated);
    color: var(--ui-text-primary);
    font-size: 11px;
  }

  .condition-row .cond-val {
    flex: 1;
    min-width: 40px;
  }

  .cond-remove {
    flex: 0 0 20px;
    background: transparent;
    border: none;
    color: var(--ui-text-muted);
    cursor: pointer;
    font-size: 14px;
    text-align: center;
    padding: 0;
  }

  .cond-remove:hover {
    color: var(--ui-danger);
  }

  .add-cond-btn {
    background: transparent;
    border: 1px dashed var(--ui-border-light);
    color: var(--ui-text-muted);
    cursor: pointer;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 11px;
    transition: all 0.15s;
    margin-top: 2px;
  }

  .add-cond-btn:hover {
    border-color: var(--ui-accent);
    color: var(--ui-accent);
  }
</style>
