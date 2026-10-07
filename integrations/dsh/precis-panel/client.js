/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copyright 2026 Precis Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * DSH Client 半（React，经 window.__ModuleLoader__ 注入）：
 *   1. tool.call.toolview[key=mcp__precis__validate_data] —— 校验结果原生富渲染
 *      （消费 validate-json-v1 契约：is_valid/summary/errors/loading_warnings）
 *   2. main[key=precis] + sidebar.panellist[id=precis] —— 完整 Precis GUI 面板
 *      （微壳同源承载 dist + 反代 /api，iframe 无 CORS/token 问题）
 * 主题全部使用 --dsw-alias-* token；文本经 locale 服务（zh/en 双语）。
 */
window.__ModuleLoader__.load({
  id: '@local/precis-panel',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'precisGui'
    const PANEL_ID = 'precis'
    // 与 Host 半 cordis.patch.yml 的 shellPort 默认值保持一致（PoC 约定；发布版应经配置下发）
    const SHELL_ORIGIN = 'http://127.0.0.1:17860'

    const dict = {
      zh: {
        'panel.title': 'Precis 数据校验',
        'panel.starting': '正在启动 Precis 后端…',
        'panel.error': '无法连接 Precis 微壳服务',
        'panel.hint': '请检查 precis-gui 插件配置（backendDir / distDir / shellPort）与 Python 环境。',
        'result.running': 'Precis 校验运行中…',
        'result.pass': '校验通过',
        'result.fail': '发现违规',
        'result.tables': '数据表',
        'result.duration': '耗时',
        'result.ms': 'ms',
        'result.errors': '违规明细',
        'result.empty': '无违规明细',
        'result.warnings': '加载警告',
        'result.raw': '原始 JSON',
        'result.showAll': '显示全部',
        'result.showLess': '收起',
        'result.invalid': '结果不是有效 JSON，显示原始文本',
        'result.col.table': '表',
        'result.col.column': '列',
        'result.col.rule': '规则',
        'result.col.row': '行',
        'result.col.cell': '值',
        'result.col.message': '错误信息',
        'result.col.file': '约束文件',
      },
      en: {
        'panel.title': 'Precis Data Validation',
        'panel.starting': 'Starting the Precis backend…',
        'panel.error': 'Cannot reach the Precis micro-shell',
        'panel.hint': 'Check the precis-gui plugin config (backendDir / distDir / shellPort) and the Python environment.',
        'result.running': 'Precis validation running…',
        'result.pass': 'All checks passed',
        'result.fail': 'Violations found',
        'result.tables': 'tables',
        'result.duration': 'in',
        'result.ms': 'ms',
        'result.errors': 'Violations',
        'result.empty': 'No violation details',
        'result.warnings': 'Loading warnings',
        'result.raw': 'Raw JSON',
        'result.showAll': 'Show all',
        'result.showLess': 'Show less',
        'result.invalid': 'Result is not valid JSON; showing raw text',
        'result.col.table': 'Table',
        'result.col.column': 'Column',
        'result.col.rule': 'Rule',
        'result.col.row': 'Row',
        'result.col.cell': 'Value',
        'result.col.message': 'Error',
        'result.col.file': 'Constraint file',
      },
    }

    /** locale.bind 在 apply 中赋值；组件渲染时经闭包读取 */
    let t = (key) => key

    const STYLE = `
.pgui-card{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:10px;padding:10px 12px;font-size:12px;color:var(--dsw-alias-label-primary)}
.pgui-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.pgui-badge{font-weight:600;padding:2px 10px;border-radius:999px;white-space:nowrap}
.pgui-ok{background:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-bg-base)}
.pgui-bad{background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-bg-base)}
.pgui-muted{color:var(--dsw-alias-label-secondary)}
.pgui-stat{white-space:nowrap}
.pgui-table{width:100%;border-collapse:collapse;margin-top:8px}
.pgui-table th,.pgui-table td{text-align:left;padding:4px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:top}
.pgui-table th{color:var(--dsw-alias-label-secondary);font-weight:500;white-space:nowrap}
.pgui-code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px}
.pgui-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:6px;padding:2px 10px;cursor:pointer;font-size:12px;margin-top:6px}
.pgui-details{margin-top:8px}
.pgui-details summary{cursor:pointer;color:var(--dsw-alias-label-secondary)}
.pgui-pre{white-space:pre-wrap;word-break:break-all;margin:6px 0 0;font-size:11px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.pgui-panel{position:relative;width:100%;height:100%;display:flex;flex-direction:column}
.pgui-frame{width:100%;height:100%;border:0;display:block;flex:1;background:var(--dsw-alias-bg-base)}
.pgui-boot{position:absolute;inset:0;z-index:2;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-base)}
.pgui-boot-card{display:flex;flex-direction:column;align-items:center;gap:10px;padding:28px 36px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:12px;color:var(--dsw-alias-label-primary)}
`

    /** Precis 徽标（表格 + 对勾），描边继承 currentColor，对勾用成功色 token */
    function PrecisIcon({ size }) {
      return h(
        'svg',
        { viewBox: '0 0 64 64', width: size, height: size, 'aria-hidden': true },
        h('rect', { x: 8, y: 12, width: 48, height: 40, rx: 6, fill: 'none', stroke: 'currentColor', 'stroke-width': 4 }),
        h('line', { x1: 8, y1: 24, x2: 56, y2: 24, stroke: 'currentColor', 'stroke-width': 4 }),
        h('line', { x1: 26, y1: 12, x2: 26, y2: 52, stroke: 'currentColor', 'stroke-width': 4 }),
        h('path', {
          d: 'M30 39 l6 6 l12 -14',
          fill: 'none',
          stroke: 'var(--dsw-alias-state-success-primary)',
          'stroke-width': 5,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        }),
      )
    }

    /** 规则类型短名：NotNullConstraint → NotNull */
    const shortRule = (type) => (typeof type === 'string' ? type.replace(/Constraints?$/, '') : '')

    /** mcp__precis__validate_data 的原生结果视图（消费 validate-json-v1 契约） */
    function ValidateDataView(props) {
      const phase = props.phase ?? props.call?.phase
      const block = props.block ?? props.call?.block
      const [showAll, setShowAll] = React.useState(false)

      if (phase !== 'result' || !block) {
        return h('div', { className: 'pgui-card pgui-muted' }, t('result.running'))
      }

      const texts = Array.isArray(block.content)
        ? block.content.filter((item) => item && item.type === 'text').map((item) => item.text).join('\n')
        : ''
      let data = null
      try {
        const parsed = JSON.parse(texts)
        if (parsed && typeof parsed === 'object' && 'is_valid' in parsed) data = parsed
      } catch {
        data = null
      }

      if (!data) {
        return h(
          'div',
          { className: 'pgui-card' },
          h('style', null, STYLE),
          block.isError ? h('div', { style: { color: 'var(--dsw-alias-state-error-primary)', fontWeight: 600 } }, 'error') : null,
          h('div', { className: 'pgui-muted', style: { marginTop: block.isError ? 4 : 0 } }, t('result.invalid')),
          h('pre', { className: 'pgui-pre' }, texts || '(no output)'),
        )
      }

      const summary = data.summary ?? {}
      const errors = Array.isArray(data.errors) ? data.errors : []
      const warnings = Array.isArray(data.loading_warnings) ? data.loading_warnings : []
      const tables = Array.isArray(data.tables) ? data.tables : []
      const visible = showAll ? errors : errors.slice(0, 20)
      const passRate =
        typeof summary.constraints_total === 'number' && summary.constraints_total > 0
          ? `${summary.constraints_passed ?? 0}/${summary.constraints_total}`
          : null

      return h(
        'div',
        { className: 'pgui-card' },
        h('style', null, STYLE),
        // 头部：结论徽章 + 通过率 + 违规数 + 表数 + 耗时
        h(
          'div',
          { className: 'pgui-head' },
          h('span', { className: `pgui-badge ${data.is_valid ? 'pgui-ok' : 'pgui-bad'}` }, t(data.is_valid ? 'result.pass' : 'result.fail')),
          passRate !== null ? h('span', { className: 'pgui-stat' }, passRate) : null,
          h('span', { className: 'pgui-stat', style: { color: 'var(--dsw-alias-state-error-primary)' } }, `✗ ${summary.constraints_failed ?? errors.length}`),
          tables.length > 0 ? h('span', { className: 'pgui-stat pgui-muted' }, `${tables.length} ${t('result.tables')}`) : null,
          typeof data.duration_ms === 'number' ? h('span', { className: 'pgui-stat pgui-muted' }, `${t('result.duration')} ${data.duration_ms}${t('result.ms')}`) : null,
          data.interrupted ? h('span', { className: 'pgui-stat', style: { color: 'var(--dsw-alias-state-warn-primary)' } }, 'interrupted') : null,
        ),
        // 违规明细表
        errors.length === 0
          ? h('div', { className: 'pgui-muted', style: { marginTop: 8 } }, t('result.empty'))
          : h(
              'table',
              { className: 'pgui-table' },
              h(
                'thead',
                null,
                h(
                  'tr',
                  null,
                  h('th', null, t('result.col.table')),
                  h('th', null, t('result.col.column')),
                  h('th', null, t('result.col.rule')),
                  h('th', null, t('result.col.row')),
                  h('th', null, t('result.col.message')),
                  h('th', null, t('result.col.file')),
                ),
              ),
              h(
                'tbody',
                null,
                visible.map((error, index) =>
                  h(
                    'tr',
                    { key: index },
                    h('td', null, String(error?.table ?? '')),
                    h('td', null, String(error?.column ?? '')),
                    h('td', { title: String(error?.error_code ?? '') }, h('span', { className: 'pgui-code' }, shortRule(error?.constraint_type))),
                    h('td', null, typeof error?.row_index === 'number' ? String(error.row_index) : ''),
                    h('td', null, String(error?.error_message ?? '')),
                    h('td', { className: 'pgui-muted pgui-code' }, String(error?.constraint_file ?? '')),
                  ),
                ),
              ),
            ),
        errors.length > 20
          ? h('button', { className: 'pgui-btn', onClick: () => setShowAll(!showAll) }, `${t(showAll ? 'result.showLess' : 'result.showAll')} (${errors.length})`)
          : null,
        // 加载警告（可折叠）
        warnings.length > 0
          ? h(
              'details',
              { className: 'pgui-details' },
              h('summary', null, `${t('result.warnings')} (${warnings.length})`),
              h(
                'ul',
                { style: { margin: '6px 0 0', paddingLeft: 18 } },
                warnings.map((warning, index) =>
                  h('li', { key: index, className: 'pgui-muted' }, String(warning?.message ?? warning?.error_type ?? warning ?? '')),
                ),
              ),
            )
          : null,
        // 原始 JSON（可折叠）
        h('details', { className: 'pgui-details' }, h('summary', null, t('result.raw')), h('pre', { className: 'pgui-pre' }, JSON.stringify(data, null, 2))),
      )
    }

    /**
     * main 面板：iframe 直载 + onload 过渡层。
     * 不做跨源 fetch 健康门控——页面（19387）到微壳（17860）是跨源请求，
     * 除非微壳返回 CORS 头，否则 fetch 必被浏览器拦截（服务端探测不受影响，
     * 这是首版卡在"正在启动"的根因）。iframe 嵌入不受 CORS 限制；后端就绪
     * 等待与重试由 Precis 应用自身完成（httpClient 对幂等 GET 自动退避重试）。
     */
    function PrecisPanel() {
      const [booted, setBooted] = React.useState(false)
      const [slow, setSlow] = React.useState(false)
      React.useEffect(() => {
        const timer = setTimeout(() => setSlow(true), 5000)
        return () => clearTimeout(timer)
      }, [])
      // iframe 文档加载完成后再留一小段过渡，避免首帧白屏闪烁
      const onFrameLoad = () => setTimeout(() => setBooted(true), 800)
      return h(
        'div',
        { className: 'pgui-panel' },
        h('style', null, STYLE),
        h('iframe', { src: `${SHELL_ORIGIN}/`, title: 'Precis', className: 'pgui-frame', onLoad: onFrameLoad }),
        !booted &&
          h(
            'div',
            { className: 'pgui-boot' },
            h(
              'div',
              { className: 'pgui-boot-card' },
              h(PrecisIcon, { size: 44 }),
              h('div', { style: { fontWeight: 600 } }, t('panel.starting')),
              slow ? h('div', { className: 'pgui-muted', style: { maxWidth: 360, textAlign: 'center' } }, t('panel.hint')) : null,
            ),
          ),
      )
    }

    return {
      // 仅 slots 为硬依赖；locale 经 ctx.get 可选获取（动态装载环境的服务表可能不同，
      // 未声明服务的硬注入会让整个模块静默不激活）
      inject: ['slots'],
      apply(ctx) {
        const locale = typeof ctx.get === 'function' ? ctx.get('locale') : undefined
        if (locale && typeof locale.register === 'function') {
          try {
            ctx.effect(() => locale.register(NS, dict), 'precis-panel: dictionaries')
            t = locale.bind(NS)
          } catch {
            t = (key) => dict.zh[key] ?? key
          }
        } else {
          t = (key) => dict.zh[key] ?? key
        }

        // 侧边栏图标（id 与 main 面板 key 共享 → 点击切换面板）
        try {
          ctx.slots.inject('sidebar.panellist', () =>
            ctx.slots.register(
              { name: 'sidebar.panellist', id: PANEL_ID, order: 30, label: () => t('panel.title') },
              PrecisIcon,
            ),
          )
        } catch (error) {
          console.error('[precis-panel] panellist registration failed:', error)
        }

        // 主面板：完整 Precis GUI（keyed 注册仅声明 key）
        try {
          ctx.slots.inject('main', () =>
            ctx.slots.register({ name: 'main', key: PANEL_ID }, PrecisPanel),
          )
        } catch (error) {
          console.error('[precis-panel] main registration failed:', error)
        }

        // 对话流：validate_data 结果原生渲染
        try {
          ctx.slots.inject('tool.call.toolview', () =>
            ctx.slots.register({ name: 'tool.call.toolview', key: 'mcp__precis__validate_data' }, ValidateDataView),
          )
        } catch (error) {
          console.error('[precis-panel] toolview registration failed:', error)
        }
      },
    }
  },
})
