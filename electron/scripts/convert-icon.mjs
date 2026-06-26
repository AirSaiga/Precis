import sharp from 'sharp'
import png2icons from 'png2icons'
import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/**
 * Precis 图标生成器
 *
 * 将一张源 PNG 自动转换为各平台所需图标:
 *   - icon.png  (512x512,  Linux)
 *   - icon.ico  (多尺寸,   Windows)
 *   - icon.icns (icon set, macOS)
 *   - icon-1024.png (中间产物, 1024x1024)
 *
 * 默认源图: electron/assets/precis_source.png
 *
 * 用法:
 *   node scripts/convert-icon.mjs                  # 用默认源图
 *   node scripts/convert-icon.mjs path/to/new.png  # 用指定源图(会复制到 assets/precis_source.png)
 *   node scripts/convert-icon.mjs --help           # 帮助
 *
 * 源图建议: >=1024x1024 的方形或近方形 PNG,透明背景。
 * 若源图含「方块 logo + 下方文字」的复合布局,会自动裁掉文字保留 logo 方块;
 * 若源图本就是纯 logo,则直接取最大方形居中区域。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const assetsDir = path.resolve(__dirname, '..', 'assets')
const DEFAULT_SOURCE = path.join(assetsDir, 'precis_source.png')

// ----------------------------------------------------------------------------
// 1. 不透明区域分析 —— 自动判断源图是否含「logo + 文字」并裁剪
// ----------------------------------------------------------------------------

/**
 * 探测源图内容边界与行间隙,返回应裁剪的方形区域(left/top/width/height)。
 *
 * 策略:
 *   - 统计每行/列的不透明像素(alpha > 阈值)。
 *   - 按行找出连续不透明段;若存在 ≥2 段且段间有较宽透明间隙,判定为「logo + 文字」,
 *     仅取最上方(通常也是最大的)段作为 logo。
 *   - 在剩余区域内取最大内切正方形,居中。
 *   - 若仅 1 段(纯 logo),取整体内容边界并向外取方形。
 */
async function detectSquareCrop(srcPath) {
  const { data, info } = await sharp(srcPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const w = info.width
  const h = info.height
  const channels = info.channels
  const alphaIdx = channels - 1
  const ALPHA_THRESHOLD = 32 // 透明背景容差

  const rowOpaque = new Array(h).fill(0)
  const colOpaque = new Array(w).fill(0)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * channels + alphaIdx] > ALPHA_THRESHOLD) {
        rowOpaque[y]++
        colOpaque[x]++
      }
    }
  }

  // 连续不透明行段
  const rowSegments = []
  let segStart = null
  for (let y = 0; y < h; y++) {
    if (rowOpaque[y] > 0) {
      if (segStart === null) segStart = y
    } else if (segStart !== null) {
      rowSegments.push({ start: segStart, end: y - 1 })
      segStart = null
    }
  }
  if (segStart !== null) rowSegments.push({ start: segStart, end: h - 1 })

  // 退化场景:整图完全透明,无法定位内容
  if (rowSegments.length === 0) {
    throw new Error('源图完全不透明像素为 0,无法检测内容边界。请提供一张非透明的图标源图。')
  }

  // 选择 logo 行范围:无论是否含「logo+文字」布局,方块 logo 通常在最上方(第一段)且最大,
  // 因此统一取第一段。hasTextLockup 仅用于诊断日志,不影响裁剪结果。
  const hasTextLockup = rowSegments.length >= 2
  const seg = rowSegments[0]
  const top = seg.start
  const bottom = seg.end

  // 在该行范围内求 x 边界
  let left = w
  let right = 0
  for (let x = 0; x < w; x++) {
    if (colOpaque[x] > 0) {
      if (x < left) left = x
      if (x > right) right = x
    }
  }

  // 取最大内切正方形并居中
  const contentW = right - left + 1
  const contentH = bottom - top + 1
  const side = Math.min(contentW, contentH)
  if (side <= 0) {
    throw new Error(
      `检测到的内容区域为 0 (contentW=${contentW}, contentH=${contentH}),无法裁剪。请检查源图内容。`,
    )
  }
  const cropLeft = Math.round(left + (contentW - side) / 2)
  const cropTop = Math.round(top + (contentH - side) / 2)

  return {
    left: Math.max(0, cropLeft),
    top: Math.max(0, cropTop),
    width: side,
    height: side,
    detected: hasTextLockup ? 'logo+text (cropped to logo block)' : 'single logo (centered square)',
    bbox: { left, top, right, bottom },
  }
}

// ----------------------------------------------------------------------------
// 2. 主流程
// ----------------------------------------------------------------------------

function printHelp() {
  console.log(
    [
      'Precis 图标生成器',
      '',
      '用法:',
      '  node scripts/convert-icon.mjs [source.png]',
      '',
      '参数:',
      '  source.png  源图路径(可选)。未提供时使用默认源图 assets/precis_source.png。',
      '              指定后会自动复制为新的默认源图,后续无需再传路径。',
      '',
      '选项:',
      '  -h, --help  显示本帮助',
      '',
      '输出(electron/assets/):',
      '  icon.png        512x512  (Linux)',
      '  icon.ico        多尺寸   (Windows)',
      '  icon.icns       icon set (macOS)',
      '  icon-1024.png   1024x1024 中间产物',
      '',
      '源图建议: >=1024x1024,透明背景。含「logo+文字」布局会自动裁掉文字。',
    ].join('\n'),
  )
}

async function main() {
  const arg = process.argv[2]
  if (arg === '-h' || arg === '--help') {
    printHelp()
    return
  }

  let srcPath = DEFAULT_SOURCE
  if (arg) {
    const abs = path.resolve(arg)
    try {
      await fs.access(abs)
    } catch {
      console.error(`✗ 源图不存在: ${abs}`)
      process.exit(1)
    }
    // 指定源图 → 固化成默认源图,后续无需再传路径
    await fs.copyFile(abs, DEFAULT_SOURCE)
    console.log(`✓ 已将源图复制为默认源图: ${path.relative(process.cwd(), DEFAULT_SOURCE)}`)
    srcPath = DEFAULT_SOURCE
  } else {
    try {
      await fs.access(DEFAULT_SOURCE)
    } catch {
      console.error(`✗ 未找到默认源图: ${DEFAULT_SOURCE}\n  用法: node scripts/convert-icon.mjs <你的图标.png>`)
      process.exit(1)
    }
  }

  const meta = await sharp(srcPath).metadata()
  console.log(`源图: ${path.relative(process.cwd(), srcPath)} (${meta.width}x${meta.height})`)

  const crop = await detectSquareCrop(srcPath)
  console.log(`裁剪策略: ${crop.detected}`, crop.bbox, `→ ${crop.width}x${crop.height}`)

  // 裁剪并放大到 1024x1024 作为主源
  const png1024 = await sharp(srcPath)
    .extract({ left: crop.left, top: crop.top, width: crop.width, height: crop.height })
    .resize(1024, 1024, { fit: 'cover' })
    .png()
    .toBuffer()
  await fs.writeFile(path.join(assetsDir, 'icon-1024.png'), png1024)
  console.log('✓ icon-1024.png (1024x1024)')

  // 512x512 PNG
  const png512 = await sharp(png1024).resize(512, 512).png().toBuffer()
  await fs.writeFile(path.join(assetsDir, 'icon.png'), png512)
  console.log('✓ icon.png (512x512, Linux)')

  // ICO (Windows)
  const ico = png2icons.createICO(png1024, png2icons.BICUBIC, false)
  if (ico) {
    await fs.writeFile(path.join(assetsDir, 'icon.ico'), ico)
    console.log('✓ icon.ico (Windows)')
  } else {
    console.error('✗ ICO 生成失败')
    process.exit(1)
  }

  // ICNS (macOS)
  const icns = png2icons.createICNS(png1024, png2icons.BICUBIC, false)
  if (icns) {
    await fs.writeFile(path.join(assetsDir, 'icon.icns'), icns)
    console.log('✓ icon.icns (macOS)')
  } else {
    console.error('✗ ICNS 生成失败')
    process.exit(1)
  }

  // 同步前端 favicon(浏览器标签图标)
  const frontendFavicon = path.resolve(__dirname, '..', '..', 'frontend', 'public', 'favicon.ico')
  await fs.copyFile(path.join(assetsDir, 'icon.ico'), frontendFavicon)
  console.log(`✓ frontend/public/favicon.ico 已同步`)

  console.log('\n完成。提示: 大尺寸场景请检查 Electron 缓存,可能需要重新构建应用。')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
