// 注意：只能从 vitepress 做「纯类型导入」——vite 5 的配置加载器把 config.ts 打成 CJS bundle，
// 运行时 import ESM-only 的 vitepress 包会触发 externalize-deps 报错（与 Node 是否支持
// require(esm) 无关）。`import type` 在打包时被整体擦除，无运行时依赖。
import type { DefaultTheme, UserConfig } from 'vitepress'

// GitHub Pages 项目页（https://airsaiga.github.io/precis/）要求 base 与仓库名一致；
// 将来绑定自定义域名（如 https://precis.xxx.com）时改为 '/'
const base = '/precis/'

const config: UserConfig<DefaultTheme.Config> = {
  lang: 'zh-CN',
  title: 'Precis',
  description: '本地优先的可视化数据质量平台——拖拽式 DAG 画布完成 Excel/CSV 数据校验',
  base,
  // 排除 README 类文件，避免误当作页面构建
  srcExclude: ['**/README.md'],
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: '指南', link: '/guide/', activeMatch: '/guide/' },
      { text: '参考', link: '/reference/', activeMatch: '/reference/' },
      { text: 'GitHub', link: 'https://github.com/AirSaiga/Precis' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: '指南',
          items: [
            { text: '介绍', link: '/guide/' },
            { text: '快速开始', link: '/guide/quick-start' },
            { text: '安装', link: '/guide/installation' },
          ],
        },
      ],
      '/reference/': [
        {
          text: '参考',
          items: [
            { text: 'CLI 参考', link: '/reference/cli' },
            { text: '配置参考', link: '/reference/config' },
          ],
        },
      ],
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/AirSaiga/Precis' }],
    outline: { level: [2, 3], label: '本页目录' },
    docFooter: { prev: '上一篇', next: '下一篇' },
    lastUpdated: {
      text: '上次更新',
      formatOptions: { dateStyle: 'short', timeStyle: 'short' },
    },
    footer: {
      message: '基于 Apache-2.0 许可发布',
      copyright: 'Copyright © 2026 Precis Team',
    },
  },
}

export default config
