/**
 * PWA / Service Worker 更新検証（FINAL GATE の G/H 項目）。
 *
 * 通常のPlaywright e2eは serviceWorkers:'block' で実行しており、実機（PWA）が実際に通る
 * 「古いSWがキャッシュ済みの旧ビルドを出す → 新ビルドへ更新される」経路を検証できていなかった。
 * このスクリプトは Service Worker を有効にした永続コンテキストで、
 *   1. ビルドAを読み込み、SWがページを制御する状態にする
 *   2. ビルドBを配信（dist を差し替え）
 *   3. 再訪問 → 自動更新（skipWaiting/clientsClaim/controllerchange再読み込み）でビルドBになること
 *   4. コンテキストを閉じて再起動（PWA再起動相当）→ 最初からビルドBであること
 * を「動作中のビルドID（JSに埋め込み）」で証明する。
 *
 * 使い方: node scripts/verify_sw_update.cjs  （localhost:4173 で vite preview が動いている前提）
 */
const { chromium } = require('@playwright/test');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const BASE = process.env.VERIFY_BASE_URL || 'http://localhost:4173';
const ROOT = path.resolve(__dirname, '..');

function build() {
  execSync('npx vite build', { cwd: ROOT, stdio: 'pipe' });
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'dist', 'build-info.json'), 'utf-8')).buildId;
}

async function openAndReadRunningBuild(page) {
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await page.getByTestId('map-root').waitFor({ state: 'visible', timeout: 20000 });
  const banner = page.getByTestId('a2hs-banner');
  if (await banner.isVisible().catch(() => false)) await page.getByTestId('a2hs-close').click();
  await page.getByTestId('tab-records').click();
  const details = page.getByTestId('diagnostics-panel');
  await details.waitFor({ state: 'visible', timeout: 10000 });
  await details.evaluate((el) => {
    el.open = true;
  });
  return (await page.getByTestId('diag-動作中のビルド').textContent()).trim();
}

async function waitForControlled(page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  // 初回は controller が無いことがあるため、1回再読み込みして制御下に入れる
  await page.reload({ waitUntil: 'load' });
  const controlled = await page.evaluate(() => navigator.serviceWorker.controller != null);
  if (!controlled) throw new Error('Service Worker がページを制御していません');
}

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'michinoeki-sw-'));
  const results = [];
  const record = (name, ok, detail) => {
    results.push({ name, ok });
    console.log(`${ok ? 'OK ' : 'NG '} ${name} :: ${detail ?? ''}`);
  };

  const buildA = build();
  console.log('build A =', buildA);

  // --- 1. ビルドAをSW制御下で読み込む ---
  let ctx = await chromium.launchPersistentContext(userDataDir, { serviceWorkers: 'allow' });
  let page = await ctx.newPage();
  await openAndReadRunningBuild(page);
  await waitForControlled(page);
  const runningA = await openAndReadRunningBuild(page);
  record('1. ビルドAがSW制御下で動作', runningA === buildA, `running=${runningA} expected=${buildA}`);
  await page.close();

  // --- 2. ビルドBを配信 ---
  await new Promise((r) => setTimeout(r, 1100)); // BUILD_IDは秒単位のため1秒以上空ける
  const buildB = build();
  console.log('build B =', buildB);
  record('2. ビルドBはビルドAと異なるID', buildB !== buildA, `${buildA} -> ${buildB}`);

  // --- 3. 再訪問: 古いSWが旧ビルドを出しても、自動更新→自動再読み込みでビルドBになる ---
  page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  // main.tsx が controllerchange で1回 location.reload() する。それを待ってから読む
  let runningAfter = null;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(1000);
    try {
      await page.getByTestId('map-root').waitFor({ state: 'visible', timeout: 5000 });
      await page.getByTestId('tab-records').click();
      const details = page.getByTestId('diagnostics-panel');
      await details.waitFor({ state: 'visible', timeout: 5000 });
      await details.evaluate((el) => {
        el.open = true;
      });
      runningAfter = (await page.getByTestId('diag-動作中のビルド').textContent()).trim();
      if (runningAfter === buildB) break;
      await page.reload({ waitUntil: 'load' });
    } catch {
      /* 自動再読み込み中はDOMが差し替わるため、次のループで再試行 */
    }
  }
  record('3. 再訪問で最新ビルドBへ自動更新される（G: SW更新後も最新build）', runningAfter === buildB, `running=${runningAfter} expected=${buildB}`);
  const uptodate = await page.getByTestId('diagnostics-uptodate').isVisible().catch(() => false);
  record('3b. 診断画面が「配信元と同じ最新版」と判定', uptodate);
  await page.close();

  // --- 4. PWA再起動相当: コンテキストを閉じて同じプロファイルで再起動 ---
  await ctx.close();
  ctx = await chromium.launchPersistentContext(userDataDir, { serviceWorkers: 'allow' });
  page = await ctx.newPage();
  const runningRestart = await openAndReadRunningBuild(page);
  record('4. 再起動後も最新ビルドB（H: PWA再起動後も最新build）', runningRestart === buildB, `running=${runningRestart}`);
  await ctx.close();

  fs.rmSync(userDataDir, { recursive: true, force: true });
  const fails = results.filter((r) => !r.ok);
  console.log('');
  console.log(`=== SW UPDATE VERIFY: ${results.length - fails.length}/${results.length} OK ===`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
