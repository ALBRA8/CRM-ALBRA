/**
 * Genera los iconos PWA de CRM ALBRA desde public/logo.svg con sharp.
 * Ejecutar una vez (o cuando cambie el logo): node scripts/generate-pwa-icons.mjs
 */
import sharp from 'sharp'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(__dirname, '..', 'public')

const svg = await readFile(path.join(publicDir, 'logo.svg'), 'utf8')
const sizes = [192, 512]

for (const size of sizes) {
  const out = path.join(publicDir, `icon-${size}.png`)
  await sharp(Buffer.from(svg))
    .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toFile(out)
  console.log(`icon-${size}.png generado`)
}
console.log('Iconos PWA listos')
