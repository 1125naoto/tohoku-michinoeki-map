/**
 * 公式ドメイン直下に置く「公式HP＋販売LP」の単独ビルド → dist-official/
 *   npx vite-node scripts/build-official.ts           # プレビュー相当（noindex・robots全拒否）
 *   OFFICIAL_LIVE=1 npx vite-node scripts/build-official.ts   # 公式ドメイン稼働用（canonical/OGP/JSON-LD/robots/sitemap を公式URLで出力）
 * OFFICIAL_LIVE=1 は、公式ドメインを実際に保有・接続できた後にだけ使う。
 */
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { renderOfficialSite } from '../src/officialSite/render';

const root = process.cwd();
const out = join(root, 'dist-official');
const live = process.env.OFFICIAL_LIVE === '1';

rmSync(out, { recursive: true, force: true });
const files = renderOfficialSite({ base: '/', assetBase: '/', standalone: true, live });
for (const [name, source] of Object.entries(files)) {
  const p = join(out, name);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, source);
}
mkdirSync(join(out, 'img'), { recursive: true });
for (const f of readdirSync(join(root, 'public', 'official', 'img'))) copyFileSync(join(root, 'public', 'official', 'img', f), join(out, 'img', f));
mkdirSync(join(out, 'icons'), { recursive: true });
for (const f of ['icon-48.png', 'icon-192.png']) copyFileSync(join(root, 'public', 'icons', f), join(out, 'icons', f));
copyFileSync(join(root, 'public', 'og-image.png'), join(out, 'og-image.png'));
console.log(`dist-official built (live=${live}): ${Object.keys(files).join(', ')}`);
