import sharp from 'sharp'
import png2icons from 'png2icons'
import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const assetsDir = path.resolve(__dirname, '..', 'assets')

async function main() {
  const svgBuffer = await fs.readFile(path.join(assetsDir, 'icon.svg'))

  // Create 1024x1024 PNG as source for all formats (ensures quality for downscaling)
  const pngBuffer = await sharp(svgBuffer)
    .resize(1024, 1024)
    .png()
    .toBuffer()

  // Create 512x512 PNG for Linux
  const png512 = await sharp(svgBuffer)
    .resize(512, 512)
    .png()
    .toBuffer()
  await fs.writeFile(path.join(assetsDir, 'icon.png'), png512)
  console.log('icon.png created (512x512)')

  // Create ICO (256x256, multi-size)
  const icoBuffer = png2icons.createICO(pngBuffer, png2icons.BICUBIC, false)
  if (icoBuffer) {
    await fs.writeFile(path.join(assetsDir, 'icon.ico'), icoBuffer)
    console.log('icon.ico created')
  } else {
    console.error('Failed to create ICO')
  }

  // Create ICNS (with 16/32/128/256/512 icon set)
  const icnsBuffer = png2icons.createICNS(pngBuffer, png2icons.BICUBIC, false)
  if (icnsBuffer) {
    await fs.writeFile(path.join(assetsDir, 'icon.icns'), icnsBuffer)
    console.log('icon.icns created')
  } else {
    console.error('Failed to create ICNS')
  }
}

main().catch(console.error)
