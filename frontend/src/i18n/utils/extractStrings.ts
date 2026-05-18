/**
 * @file extractStrings.ts
 * @description i18n 字符串提取工具
 *
 * 功能概述：
 * - 提供常见字符串匹配模式
 * - 维护手动提取的常用中文字符串列表
 * - 提供从文件内容提取字符串的工具函数
 * - 生成国际化键名推荐策略
 */

// 需要扫描的常见字符串模式
export const commonPatterns = [
  // Vue 模板中的文本内容
  /(?<![\w>])["'`]([^"'`]*?)["'`](?!\s*[=>])/g,
  
  // 错误消息和其他显示文本
  /['"`]([^'"`]*?[加载|错误|成功|保存|删除|编辑|创建|添加|移除|搜索|筛选|重置|清除|刷新|关闭|打开|导出|导入|返回|下一步|上一步|是|否|名称|描述|类型|状态|日期|时间|ID|版本|启用|禁用|活跃|非活跃|必填|可选|有效|无效|选择|全部|无][^'"`]*?)["'"]/g,
]

// 手动提取的常用字符串
export const extractedStrings = [
  // 应用标题
  'DataValidator',
  
  // 导航菜单
  '仪表盘',
  'Schema 配置', 
  '表达式规则',
  '报告配置',
  
  // 通用操作
  '切换项目',
  '开始校验',
  '编辑配置',
  '查看历史报告',
  
  // 状态信息
  '正在加载项目信息...',
  '无法加载项目信息：',
  '表结构 (Schemas)',
  '约束规则',
  '上次校验时间',
  '项目信息',
  '工作区',
  '新建画布工作区',
  
  // 确认对话框
  '您确定要切换项目吗？所有未保存的更改都将丢失。',
  '您确定要删除此项吗？此操作不可恢复。',
  '您确定要执行此操作吗？',
  
  // 面板和组件
  '资产库',
  '节点画布',
  '检查器面板',
  '状态栏',
  '欢迎',
  '帮助',
  '社区',
  '生态系统',
  '文档',
  '工具',
  '支持',
  
  // 列定义
  '列定义',
  '表定义',
  '正则表达式集',
  '正则表达式',
  '约束规则集',
  
  // 数据相关
  '数据类型',
  '约束条件',
  '外键约束',
  '唯一约束',
  '非空约束',
  '自定义约束',
  '正则表达式约束',
  '条件约束',
  '允许值约束',
  
  // 表达式和规则
  '交互式构建器',
  '参数定义',
  '规则配置',
  '规则列表',
  '规则测试',
  '表达式编辑器',
  '表达式构建器',
  '选择弹出框',
  
  // 配置和设置
  '配置编辑器',
  '项目设置',
  '报告配置',
  'Webhook配置',
  '脚本检查',
  'WebHook',
  
  // 通用状态
  '加载中...',
  '保存中...',
  '处理中...',
  '校验中...',
  '验证中...',
  '更新中...',
  '创建中...',
  '删除中...',
  '发送中...',
  '接收中...',
  '同步中...',
  '导入中...',
  '导出中...',
  
  // 错误消息
  '网络错误',
  '请求失败',
  '数据加载失败',
  '保存失败',
  '删除失败',
  '创建失败',
  '更新失败',
  '校验失败',
  '验证失败',
  '同步失败',
  '导入失败',
  '导出失败',
  
  // 成功消息
  '保存成功',
  '删除成功',
  '创建成功',
  '更新成功',
  '校验成功',
  '验证成功',
  '同步成功',
  '导入成功',
  '导出成功',
  '操作成功',
  
  // 按钮和控件
  '确定',
  '取消',
  '保存',
  '编辑',
  '删除',
  '新增',
  '重置',
  '筛选',
  '搜索',
  '导出',
  '导入',
  '刷新',
  '刷新数据',
  
  // 表单相关
  '输入',
  '选择',
  '文本',
  '文件',
  '图片',
  '日期',
  '时间',
  
  // 布局相关
  '左侧',
  '右侧',
  '顶部',
  '底部',
  '居中',
  '左对齐',
  '右对齐',
  '两端对齐',
  '水平',
  '垂直',
  
  // 分页相关
  '页码',
  '总页数',
  '上一页',
  '下一页',
  '首页',
  '尾页',
  
  // 筛选相关
  '全部',
  '是',
  '否',
  '启用',
  '禁用',
  '激活',
  '停用',
  
  // 排序相关
  '升序',
  '降序',
  '自定义',
  
  // 视图相关
  '列表',
  '网格',
  '表格',
  '卡片',
  '树形',
  
  // 操作相关
  '点击',
  '双击',
  '拖拽',
  '选择',
  '复制',
  '剪切',
  '粘贴',
  
  // 验证相关
  '必填',
  '可选',
  '格式错误',
  '长度超限',
  '唯一性验证',
  '数据格式',
  
  // 权限相关
  '管理员',
  '普通用户',
  '访客',
  '只读',
  '读写',
  
  // 系统相关
  '系统',
  '用户',
  '权限',
  '角色',
  '配置',
  '设置',
  '偏好',
  
  // 图表相关
  '图表',
  '图表类型',
  '线形图',
  '柱状图',
  '饼图',
  '散点图',
  '面积图',
  
  // 文件相关
  '文件类型',
  '文件大小',
  '上传',
  '下载',
  '预览',
  '重命名',
  '移动',
  
  // 时间相关
  '创建时间',
  '更新时间',
  '删除时间',
  '生效时间',
  '过期时间',
  '访问时间',
  '修改时间',
  
  // 更多常用字符串...
]

// 推荐的键命名规范
export const namingConvention = {
  // 使用点分隔的层级结构
  // 例如: common.save, navigation.dashboard, dashboard.loading
  common: '通用词汇和操作',
  navigation: '导航菜单',
  dashboard: '仪表盘页面',
  config: '配置相关',
  customNodes: '自定义节点',
  expression: '表达式相关',
  icons: '图标标签',
  messages: '消息提示',
  buttons: '按钮文字',
  forms: '表单相关',
  validation: '验证相关',
  error: '错误消息',
  success: '成功消息',
  warning: '警告消息',
  info: '信息提示',
  settings: '设置相关',
  filters: '筛选相关',
  sorting: '排序相关',
  pagination: '分页相关',
  permissions: '权限相关',
  system: '系统相关',
  layout: '布局相关',
  file: '文件相关',
  chart: '图表相关',
  table: '表格相关',
  date: '时间相关',
  status: '状态相关',
  action: '操作相关',
  menu: '菜单相关',
  tooltip: '提示文本',
  placeholder: '占位符',
  label: '标签文本',
  title: '标题文本',
  description: '描述文本',
  help: '帮助文本',
  contact: '联系方式',
  about: '关于信息',
  privacy: '隐私相关',
  terms: '条款相关',
  feedback: '反馈相关',
  support: '支持相关',
  tools: '工具相关',
  report: '报告相关',
  analysis: '分析相关',
  statistics: '统计相关',
  monitoring: '监控相关',
  alert: '告警相关',
  log: '日志相关',
  debug: '调试相关',
  test: '测试相关',
  build: '构建相关',
  deploy: '部署相关',
  release: '发布相关',
  version: '版本相关',
  update: '更新相关',
  upgrade: '升级相关',
  downgrade: '降级相关',
  backup: '备份相关',
  restore: '还原相关',
  export: '导出相关',
  import: '导入相关',
  sync: '同步相关',
  connect: '连接相关',
  disconnect: '断开相关',
  online: '在线相关',
  offline: '离线相关',
  enable: '启用相关',
  disable: '禁用相关',
  activate: '激活相关',
  deactivate: '停用相关',
  start: '开始相关',
  stop: '停止相关',
  pause: '暂停相关',
  resume: '恢复相关',
  restart: '重启相关',
  reload: '重新加载相关',
  refresh: '刷新相关',
  reset: '重置相关',
  clear: '清除相关',
  cache: '缓存相关',
  session: '会话相关',
  cookie: 'Cookie相关',
  token: '令牌相关',
  auth: '认证相关',
  login: '登录相关',
  logout: '登出相关',
  register: '注册相关',
  profile: '个人资料相关',
  account: '账户相关',
  user: '用户相关',
  group: '组相关',
  team: '团队相关',
  organization: '组织相关',
  department: '部门相关',
  role: '角色相关',
  permission: '权限相关',
  access: '访问相关',
  level: '级别相关',
  scope: '范围相关',
  domain: '域相关',
  environment: '环境相关',
  production: '生产相关',
  development: '开发相关',
  staging: '测试相关',
  sandbox: '沙盒相关',
  local: '本地相关',
  remote: '远程相关',
  global: '全局相关',
  localStorage: '本地存储相关',
  sessionStorage: '会话存储相关',
  database: '数据库相关',
  server: '服务器相关',
  client: '客户端相关',
  api: 'API相关',
  endpoint: '端点相关',
  request: '请求相关',
  response: '响应相关',
  method: '方法相关',
  header: '头部相关',
  body: '主体相关',
  payload: '载荷相关',
  query: '查询相关',
  parameter: '参数相关',
  argument: '参数相关',
  option: '选项相关',
  flag: '标记相关',
  switch: '开关相关',
  toggle: '切换相关',
  checkbox: '复选框相关',
  radio: '单选框相关',
  dropdown: '下拉框相关',
  select: '选择相关',
  multiSelect: '多选相关',
  input: '输入相关',
  textarea: '文本域相关',
  text: '文本相关',
  number: '数字相关',
  email: '邮箱相关',
  url: 'URL相关',
  phone: '电话相关',
  address: '地址相关',
  location: '位置相关',
  country: '国家相关',
  region: '地区相关',
  city: '城市相关',
  language: '语言相关',
  currency: '货币相关',
  timezone: '时区相关',
  locale: '区域相关',
  format: '格式相关',
  template: '模板相关',
  theme: '主题相关',
  style: '样式相关',
  skin: '皮肤相关',
  appearance: '外观相关',
  look: '外观相关',
  feel: '体验相关',
  userInterface: '用户界面相关',
  userExperience: '用户体验相关',
  usability: '可用性相关',
  accessibility: '可访问性相关',
  compatibility: '兼容性相关',
  performance: '性能相关',
  efficiency: '效率相关',
  speed: '速度相关',
  optimization: '优化相关',
  resource: '资源相关',
  memory: '内存相关',
  storage: '存储相关',
  bandwidth: '带宽相关',
  throughput: '吞吐量相关',
  latency: '延迟相关',
  responseTime: '响应时间相关',
  loadTime: '加载时间相关',
  rendering: '渲染相关',
  drawing: '绘制相关',
  painting: '绘制相关',
  animation: '动画相关',
  transition: '过渡相关',
  effect: '效果相关',
  filter: '过滤器相关',
  masks: '遮罩相关',
  overlay: '覆盖层相关',
  background: '背景相关',
  foreground: '前景相关',
  border: '边框相关',
  margin: '边距相关',
  padding: '填充相关',
  spacing: '间距相关',
  gap: '间隙相关',
  alignment: '对齐相关',
  position: '位置相关',
  coordinate: '坐标相关',
  axis: '轴相关',
  direction: '方向相关',
  orientation: '方向相关',
  dimension: '尺寸相关',
  width: '宽度相关',
  height: '高度相关',
  length: '长度相关',
  size: '大小相关',
  scale: '缩放相关',
  zoom: '缩放相关',
  pan: '平移相关',
  move: '移动相关',
  translate: '平移相关',
  rotate: '旋转相关',
  transform: '变换相关',
  perspective: '透视相关',
  perspectiveOrigin: '透视原点相关',
  transformOrigin: '变换原点相关',
  transformStyle: '变换样式相关',
  backfaceVisibility: '背面可见性相关',
  perspectiveOriginX: '透视原点X相关',
  perspectiveOriginY: '透视原点Y相关',
  perspectiveZ: '透视Z相关',
  scaleX: '缩放X相关',
  scaleY: '缩放Y相关',
  scaleZ: '缩放Z相关',
  rotateX: '旋转X相关',
  rotateY: '旋转Y相关',
  rotateZ: '旋转Z相关',
  skewX: '倾斜X相关',
  skewY: '倾斜Y相关',
  translateX: '平移X相关',
  translateY: '平移Y相关',
  translateZ: '平移Z相关',
  matrix: '矩阵相关',
  matrix3d: '3D矩阵相关',
  clipPath: '剪裁路径相关',
  filterBlur: '模糊效果相关',
  filterBrightness: '亮度效果相关',
  filterContrast: '对比度效果相关',
  filterDropShadow: '投影效果相关',
  filterGrayscale: '灰度效果相关',
  filterHueRotate: '色相旋转相关',
  filterInvert: '反相效果相关',
  filterOpacity: '透明度效果相关',
  filterSaturate: '饱和度效果相关',
  filterSepia: '怀旧效果相关',
  filterBrightnessContrast: '亮对比效果相关',
  filterHue: '色相效果相关',
  filterSaturateOpacity: '饱和透明效果相关',
  filterUrl: 'URL效果相关',
  filterUrlBrightness: 'URL亮效果相关',
  filterUrlContrast: 'URL对比效果相关',
  filterUrlDropShadow: 'URL投影效果相关',
  filterUrlGrayscale: 'URL灰度效果相关',
  filterUrlHueRotate: 'URL色相旋转相关',
  filterUrlInvert: 'URL反相效果相关',
  filterUrlOpacity: 'URL透明效果相关',
  filterUrlSaturate: 'URL饱和度效果相关',
  filterUrlSepia: 'URL怀旧效果相关',
  filterUrlBrightnessContrast: 'URL亮对比效果相关',
  filterUrlHue: 'URL色相效果相关',
  filterUrlSaturateOpacity: 'URL饱和透明效果相关',
  fill: '填充相关',
  strokeStyle: '描边样式相关',
  strokeWidths: '描边宽度相关',
  strokeOpacity: '描边透明度相关',
  strokeDasharray: '描边虚线相关',
  strokeDashoffset: '描边虚线偏移相关',
  strokeLinecap: '描边端点相关',
  strokeLinejoin: '描边连接相关',
  strokeMiterlimit: '描边斜接限制相关',
  fillOpacity: '填充透明度相关',
  fillRule: '填充规则相关',
  clipPathUnits: '剪裁路径单位相关',
  clipRule: '剪裁规则相关',
  colorInterpolation: '颜色插值相关',
  colorInterpolationFilters: '颜色插值过滤器相关',
  colorProfile: '颜色配置文件相关',
  colorRendering: '颜色渲染相关',
  dominantBaseline: '主要基线相关',
  enableBackground: '启用背景相关',
  fillColor: '填充颜色相关',
  fillOpacityColor: '填充透明颜色相关',
  fillOpacityFilter: '填充透明过滤器相关',
  fillOpacityLighting: '填充透明光照相关',
  fillOpacityOffset: '填充透明偏移相关',
  fillOpacityStopColor: '填充透明停止颜色相关',
  fillOpacityStopOpacity: '填充透明停止透明度相关',
  fillOpacityURL: '填充透明URL相关',
  fillPaint: '填充绘制相关',
  fillRuleEvenodd: '填充规则奇偶相关',
  fillRuleNonzero: '填充规则非零相关',
  fillStroke: '填充描边相关',
  fillTransform: '填充变换相关',
  floodColor: '洪水颜色相关',
  floodOpacity: '洪水透明度相关',
  font: '字体相关',
  fontFamily: '字体族相关',
  fontSize: '字体大小相关',
  fontStretch: '字体拉伸相关',
  fontStyle: '字体样式相关',
  fontVariant: '字体变体相关',
  fontWeight: '字体粗细相关',
  glyphOrientationHorizontal: '字形水平方向相关',
  glyphOrientationVertical: '字形垂直方向相关',
  kerning: '字距相关',
  letterSpacing: '字母间距相关',
  lightingColor: '光照颜色相关',
  lineHeight: '行高相关',
  marker: '标记相关',
  markerEnd: '标记结束相关',
  markerMid: '标记中间相关',
  markerStart: '标记开始相关',
  mask: '遮罩相关',
  maskContentUnits: '遮罩内容单位相关',
  maskUnits: '遮罩单位相关',
  opacity: '透明度相关',
  overflow: '溢出相关',
  pointerEvents: '指针事件相关',
  shapeRendering: '形状渲染相关',
  stopColor: '停止颜色相关',
  stopOpacity: '停止透明度相关',
  stroke: '描边相关',
  strokeWidth: '描边宽度相关',
  textAnchor: '文本锚点相关',
  textDecoration: '文本装饰相关',
  textRendering: '文本渲染相关',
  unicodeBidi: 'Unicode双向相关',
  vectorEffect: '矢量效果相关',
  visibility: '可见性相关',
  wordSpacing: '单词间距相关',
  writingMode: '书写模式相关'
}

// 提取字符串的工具函数
export function extractStringsFromFile(content: string): string[] {
  const extractedStrings = new Set<string>()
  
  // 匹配各种字符串模式
  const patterns = [
    // 模板字符串和文本内容
    /(?<![\w>])["'`]([^"'`]*?)["'`](?!\s*[=>])/g,
    // 带有翻译标识的字符串
    /(?:\$t|t)\(["'`]([^"'`]*?)["'`]\)/g,
    // 中文字符串（可能包含常见词汇）
    /['"`]([^'"`]*?[加载|错误|成功|保存|删除|编辑|创建|添加|移除|搜索|筛选|重置|清除|刷新|关闭|打开|导出|导入|返回|下一步|上一步|是|否|名称|描述|类型|状态|日期|时间|ID|版本|启用|禁用|活跃|非活跃|必填|可选|有效|无效|选择|全部|无|确认|项目|配置|表达式|规则|约束|校验|数据|表|列|字段][^'"`]*?)["'"]/g
  ]
  
  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(content)) !== null) {
      const str = match[1].trim()
      if (str.length > 0 && str.length < 200) {
        extractedStrings.add(str)
      }
    }
  }
  
  return Array.from(extractedStrings).sort()
}

// 推荐的国际化键名生成策略
export function generateI18nKeys(strings: string[]): { [key: string]: string } {
  const keys: { [key: string]: string } = {}
  
  strings.forEach(str => {
    let key = str
      .toLowerCase()
      .replace(/[^\w\s]/g, '') // 移除标点符号
      .replace(/\s+/g, '.') // 空格替换为点
      .replace(/.+/g, match => match.charAt(0).toLowerCase() + match.slice(1)) // 首字母小写
    
    // 根据内容添加前缀
    if (str.includes('加载') || str.includes('保存') || str.includes('处理')) {
      key = `common.status.${key}`
    } else if (str.includes('仪表盘') || str.includes('配置') || str.includes('校验')) {
      key = `dashboard.${key}`
    } else if (str.includes('导航') || str.includes('菜单')) {
      key = `navigation.${key}`
    } else if (str.includes('按钮') || str.includes('确定') || str.includes('取消')) {
      key = `buttons.${key}`
    } else if (str.includes('错误') || str.includes('成功') || str.includes('警告')) {
      key = `messages.${key}`
    } else {
      key = `common.${key}`
    }
    
    keys[key] = str
  })
  
  return keys
}

// 导出所有数据
export default {
  commonPatterns,
  extractedStrings,
  namingConvention,
  extractStringsFromFile,
  generateI18nKeys
}