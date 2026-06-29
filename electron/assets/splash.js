/**
 * Splash 渲染进程逻辑
 *
 * 职责:
 * - 接收主进程推送的启动阶段状态,切换中英双语文案
 * - 文字切换时淡出旧 → 淡入新(150ms 各方向)
 * - 错误状态时 spinner 变红
 * - done 状态时给卡片添加 fade-out 类(配合 CSS 过渡)
 * - 启动时查询版本号并填入右下角
 *
 * 通过 window.splashAPI 与主进程通信(由 splash-preload.js 桥接暴露)。
 */

// 各阶段对应的中英双语文案(与 spec §5 一致)
const STAGE_TEXT = {
  initializing: { zh: '正在初始化应用', en: 'Initializing application' },
  starting: { zh: '正在启动后端服务', en: 'Starting backend service' },
  connecting: { zh: '正在连接后端服务', en: 'Connecting to backend service' },
  loading: { zh: '正在加载工作区', en: 'Loading workspace' },
  done: { zh: '就绪', en: 'Ready' },
  error: { zh: '后端启动失败', en: 'Backend failed to start' },
}

// DOM 引用
const statusZh = document.getElementById('status-zh')
const statusZhText = document.getElementById('status-zh-text')
const statusEn = document.getElementById('status-en')
const spinner = document.getElementById('spinner')
const card = document.getElementById('card')

/**
 * 切换状态文案(淡出旧 → 更新 → 淡入新)
 * @param {string} stage - 阶段 key
 * @param {boolean} isError - 是否错误状态
 */
function applyStage(stage, isError) {
  const text = STAGE_TEXT[stage]
  if (!text) return

  // 错误状态立即切换 spinner 颜色
  if (isError) {
    spinner.classList.add('error')
  }

  // 文字淡出(150ms)
  statusZh.classList.add('switching')
  statusEn.classList.add('switching')

  setTimeout(() => {
    // 更新文字
    statusZhText.textContent = text.zh
    statusEn.textContent = text.en
    // 淡入(移除 .switching,由 CSS transition 恢复 opacity)
    statusZh.classList.remove('switching')
    statusEn.classList.remove('switching')

    // done 状态触发淡出
    if (stage === 'done') {
      card.classList.add('fade-out')
    }
  }, 150)
}

// 注册 IPC 监听
if (window.splashAPI) {
  window.splashAPI.onStage(({ stage, error }) => {
    applyStage(stage, error === true)
  })

  // 启动时查询版本号并填入
  window.splashAPI
    .getVersion()
    .then((version) => {
      document.getElementById('version').textContent = `v${version}`
    })
    .catch(() => {
      // 版本号查询失败静默忽略(非关键信息)
    })
} else {
  // splashAPI 不可用(理论上不该发生,preload 应已桥接)。
  // 渐进降级:splash 保持 HTML 默认 initializing 状态,不卡死。
  console.warn('splashAPI unavailable, splash will stay in default state')
}
