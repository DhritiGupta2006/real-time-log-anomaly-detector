import fs from 'node:fs'
import path from 'node:path'

/**
 * Image processing script.
 * RULE: NEVER writes or overwrites public/shots/hero.jpg or trail-1.jpg ... trail-6.jpg.
 * It may ONLY create placeholders for alert-feed.png and cloudwatch.png, and ONLY when missing.
 */
const SHOTS_DIR = path.resolve(process.cwd(), 'public/shots')

if (!fs.existsSync(SHOTS_DIR)) {
  fs.mkdirSync(SHOTS_DIR, { recursive: true })
}

const PROTECTED_FILES = [
  'hero.jpg',
  'trail-1.jpg',
  'trail-2.jpg',
  'trail-3.jpg',
  'trail-4.jpg',
  'trail-5.jpg',
  'trail-6.jpg',
]

// Fallback solid #171717 tile
const SOLID_17_PNG = Buffer.from([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xDE, 0x00, 0x00, 0x00,
  0x0C, 0x49, 0x44, 0x41, 0x54, 0x08, 0xD7, 0x63, 0x62, 0x62, 0x62, 0x02,
  0x00, 0x00, 0xD1, 0x00, 0x47, 0xB6, 0xDF, 0xF9, 0xC8, 0x00, 0x00, 0x00,
  0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
])

const PLACEHOLDERS_ONLY = ['alert-feed.png', 'cloudwatch.png']

for (const file of PLACEHOLDERS_ONLY) {
  const target = path.join(SHOTS_DIR, file)
  if (!fs.existsSync(target)) {
    fs.writeFileSync(target, SOLID_17_PNG)
    console.log(`Created placeholder for missing ${file}`)
  }
}

console.log('process-images: Protected files safe; verified placeholder assets.')
