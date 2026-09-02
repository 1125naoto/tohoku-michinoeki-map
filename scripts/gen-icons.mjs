/**
 * PWAアイコン生成（外部依存なし・Node標準のzlibのみ使用）。
 * 緑地に白い地図ピンのシンプルなデザインを描画して PNG を出力する。
 * 実行: npm run gen-icons
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256).map((_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c;
    });
  }
  let crc = -1;
  for (const b of buf) crc = (crc >>> 8) ^ table[(crc ^ b) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** アイコン描画: 角丸緑背景 + 白ピン + 緑の穴 + 道路の白線 */
function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const bg = [46, 125, 50]; // #2e7d32
  const bgDark = [27, 94, 32];
  const white = [255, 255, 255];
  const corner = size * 0.18;
  const cx = size / 2;
  const headY = size * 0.4;
  const headR = size * 0.24;
  const holeR = size * 0.1;
  const tipY = size * 0.78;

  const inRounded = (x, y) => {
    const rx = Math.max(corner - x, x - (size - 1 - corner), 0);
    const ry = Math.max(corner - y, y - (size - 1 - corner), 0);
    return rx * rx + ry * ry <= corner * corner;
  };
  // ピンの三角形（頭の円の下端から先端へ）
  const inTriangle = (x, y) => {
    if (y < headY || y > tipY) return false;
    const t = (y - headY) / (tipY - headY);
    const half = headR * 0.92 * (1 - t);
    return Math.abs(x - cx) <= half;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (!inRounded(x, y)) {
        px[i + 3] = 0;
        continue;
      }
      // 背景（下側をやや暗く）
      let c = y > size * 0.82 ? bgDark : bg;
      // 下部の「道路」白破線
      const roadY = size * 0.9;
      if (Math.abs(y - roadY) < size * 0.018 && Math.floor(x / (size * 0.12)) % 2 === 0) c = white;
      // ピン
      const dHead = Math.hypot(x - cx, y - headY);
      if (dHead <= headR || inTriangle(x, y)) c = white;
      if (dHead <= holeR) c = bg;
      px[i] = c[0];
      px[i + 1] = c[1];
      px[i + 2] = c[2];
      px[i + 3] = 255;
    }
  }
  return encodePng(size, size, px);
}

const outDir = join(root, 'public', 'icons');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'icon-192.png'), drawIcon(192));
writeFileSync(join(outDir, 'icon-512.png'), drawIcon(512));
writeFileSync(join(outDir, 'apple-touch-icon.png'), drawIcon(180));
console.log('icons generated in public/icons/');
