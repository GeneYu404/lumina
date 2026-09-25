import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import pngjs from 'pngjs'

const { PNG } = pngjs
const out = path.resolve('build/icons')
mkdirSync(out, { recursive: true })

function insidePolygon(x, y, points) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]
    const [xj, yj] = points[j]
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function rgbaAt(x, y, variant) {
  const radius = 0.205
  const dx = Math.max(0.08 + radius - x, x - (0.92 - radius), 0)
  const dy = Math.max(0.08 + radius - y, y - (0.92 - radius), 0)
  if (Math.hypot(dx, dy) > radius) return [0, 0, 0, 0]
  const t = Math.min(1, Math.max(0, (x + y) / 2))
  const base = variant === 0
    ? [Math.round(82 - 54 * t), Math.round(207 - 92 * t), Math.round(252 - 16 * t)]
    : [Math.round(91 + 120 * t), Math.round(107 + 54 * t), Math.round(246 - 52 * t)]
  if (Math.hypot(x - 0.71, y - 0.315) <= 0.075) return [255, 214, 107, 255]
  const hills = [[0.04, 0.86], [0.35, 0.42], [0.60, 0.71], [0.70, 0.57], [0.96, 0.86]]
  const polygon = [...hills, [0.96, 0.99], [0.04, 0.99]]
  if (insidePolygon(x, y, polygon)) {
    return [Math.round(247 - y * 45), Math.round(252 - y * 9), 255, 255]
  }
  return [...base, 255]
}

function picture(width, height, variant = 0) {
  const png = new PNG({ width, height })
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      // Four samples make the icon edges legible even at 16 pixels.
      const pixel = [0, 0, 0, 0]
      for (const oy of [0.25, 0.75]) for (const ox of [0.25, 0.75]) {
        const color = rgbaAt((x + ox) / width, (y + oy) / height, variant)
        for (let channel = 0; channel < 4; channel++) pixel[channel] += color[channel] / 4
      }
      for (let channel = 0; channel < 4; channel++) png.data[idx + channel] = Math.round(pixel[channel])
    }
  }
  return PNG.sync.write(png)
}

// Source for `npx tauri icon`, which writes every size (and icon.ico) to src-tauri/icons.
writeFileSync(path.join(out, 'app-icon.png'), picture(1024, 1024))
console.log('Created build/icons/app-icon.png (1024×1024).')