/**
 * NAMI FINAL GATE 受け入れ検証（PHASE 10 A〜F, I）。
 * 対象は「スマホ実機テスト開始.bat が実際に発行したHTTPS URL」（%TEMP%\michinoeki_https_url.txt）。
 * モックは Overpass の遮断と、位置情報のエラー種別再現のみ（静的POIデータ・配信物は本物）。
 *
 * 使い方: node scripts/final_gate_check.cjs [https://...]
 */
const { chromium, webkit, devices } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const URL =
  process.argv[2] ||
  fs.readFileSync(path.join(os.tmpdir(), 'michinoeki_https_url.txt'), 'utf-8').trim();
const ROOT = path.resolve(__dirname, '..');
const localBuild = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist', 'build-info.json'), 'utf-8'));

const GOLDEN = [
  { id: 'mne-18967', name: 'みなみかた', pref: '宮城県' },
  { id: 'mne-18963', name: '米山', pref: '宮城県' },
  { id: 'mne-19015', name: '白鷹ヤナ公園', pref: '山形県' },
];

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${detail ? ' :: ' + detail : ''}`);
}

async function httpsJson(p) {
  const res = await fetch(`${URL}${p}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${p} -> HTTP ${res.status}`);
  return res.json();
}

async function withPage(browserType, opts, fn) {
  const browser = await browserType.launch();
  const ctx = await browser.newContext({ ...opts, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  try {
    await fn(page);
  } finally {
    await browser.close();
  }
}

async function openApp(page) {
  await page.goto(`${URL}/`);
  await page.getByTestId('map-root').waitFor({ state: 'visible', timeout: 20000 });
  const banner = page.getByTestId('a2hs-banner');
  if (await banner.isVisible().catch(() => false)) await page.getByTestId('a2hs-close').click();
  const legend = page.getByTestId('legend-panel');
  if (await legend.isVisible().catch(() => false)) await page.getByTestId('legend-toggle').click();
}

(async () => {
  console.log('TARGET URL =', URL);
  console.log('LOCAL BUILD =', localBuild.buildId);

  // ---- A. 配信中ビルド == ローカルビルド（HTTPS経由） ----
  const served = await httpsJson('/build-info.json');
  record('A. HTTPS配信中のビルドID == 今回ビルドしたID', served.buildId === localBuild.buildId, `${served.buildId}`);
  record('A2. 配信中のPOIデータ版 == ローカル', served.poiDataVersion === localBuild.poiDataVersion, `${served.poiDataVersion} (${served.poiDataFiles}駅)`);

  // ---- B. HTTPSから取得したPOI JSONにラーメンが存在（実店名） ----
  const ramenByStation = {};
  for (const g of GOLDEN) {
    const data = await httpsJson(`/data/poi/${g.id}.json`);
    const ramen = data.pois.filter((p) => (p.subcategories ?? [p.subcategory]).includes('ramen'));
    ramenByStation[g.id] = ramen;
    record(`B. HTTPS取得JSON ${g.name}(${g.id}) にラーメン${ramen.length}件`, ramen.length >= 3, ramen.slice(0, 3).map((p) => p.name).join(' / '));
  }

  for (const [tag, browserType, opts] of [
    ['iPhone13', webkit, devices['iPhone 13']],
    ['Pixel5', chromium, devices['Pixel 5']],
  ]) {
    // ---- A3. 端末で動作中のビルドID（診断画面） == 配信中 ----
    await withPage(browserType, opts, async (page) => {
      await openApp(page);
      await page.getByTestId('tab-records').click();
      const panel = page.getByTestId('diagnostics-panel');
      await panel.waitFor({ state: 'visible', timeout: 10000 });
      await panel.evaluate((el) => {
        el.open = true;
      });
      const running = (await page.getByTestId('diag-動作中のビルド').textContent()).trim();
      record(`[${tag}] A3. 端末の動作中ビルド == 配信中ビルド`, running === served.buildId, running);
      await page.getByTestId('diagnostics-uptodate').waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
      record(`[${tag}] A4. 診断画面「配信元と同じ最新版」表示`, await page.getByTestId('diagnostics-uptodate').isVisible().catch(() => false));
      const secure = (await page.getByTestId('diag-Secure Context').textContent()) ?? '';
      record(`[${tag}] E. Secure Context = はい（診断画面）`, secure.startsWith('はい'), secure);
    });

    // ---- C/D. ラーメン: 一覧 + 地図マーカー（実店名でマーカー存在を確認）+ カテゴリ切替後 ----
    for (const g of GOLDEN) {
      await withPage(browserType, opts, async (page) => {
        await page.route('**/api/interpreter', (route) => route.abort());
        await openApp(page);
        await page.getByTestId('poi-search-open').click();
        await page.getByTestId('poi-origin-pref-select').selectOption(g.pref);
        await page.getByTestId('poi-origin-station-select').selectOption(g.id);
        await page.getByTestId('poi-do-search').click();
        await page.getByTestId('poi-result-count').waitFor({ state: 'visible', timeout: 15000 });
        await page.getByTestId('poi-category-food').click();
        await page.getByTestId('poi-subcategory-ramen').click();
        await page.waitForTimeout(400);
        const expected = ramenByStation[g.id];
        const rows = await page.getByTestId('poi-result-row').allTextContents();
        const markerIds = await page.locator('.poi-marker').evaluateAll((els) => els.map((e) => e.getAttribute('data-poi-id')));
        const namesInList = expected.filter((p) => rows.some((r) => r.includes(p.name))).length;
        const markersMatch = expected.filter((p) => markerIds.includes(p.id)).length;
        record(
          `[${tag}] C. ${g.name}: ラーメン一覧${rows.length}件・店名一致${namesInList}/${expected.length}`,
          rows.length === expected.length && namesInList === expected.length,
        );
        record(
          `[${tag}] C2. ${g.name}: 地図マーカー${markerIds.length}件・同じPOI IDのマーカー${markersMatch}/${expected.length}`,
          markerIds.length === expected.length && markersMatch === expected.length,
          expected.slice(0, 3).map((p) => p.name).join(' / '),
        );
        // D. カテゴリをまたいで切り替えた後も表示される
        await page.getByTestId('poi-category-all').click();
        await page.getByTestId('poi-category-onsen').click();
        await page.getByTestId('poi-category-food').click();
        await page.getByTestId('poi-subcategory-ramen').click();
        await page.waitForTimeout(400);
        const rowsAfter = await page.getByTestId('poi-result-row').count();
        const markersAfter = await page.locator('.poi-marker').count();
        record(`[${tag}] D. ${g.name}: カテゴリ切替後もラーメン表示`, rowsAfter === expected.length && markersAfter === expected.length, `rows=${rowsAfter} markers=${markersAfter}`);
      });
    }

    // ---- F. 位置情報エラー種別が識別可能（診断画面の「現在地を取得してみる」） ----
    for (const [code, expectText] of [
      [1, '許可されていません'],
      [2, '電波状況'],
      [3, '時間がかかっています'],
    ]) {
      await withPage(browserType, opts, async (page) => {
        await page.addInitScript((c) => {
          Object.defineProperty(navigator, 'geolocation', {
            configurable: true,
            value: { getCurrentPosition: (_ok, err) => setTimeout(() => err({ code: c, message: `mock code ${c}` }), 30) },
          });
        }, code);
        await openApp(page);
        await page.getByTestId('tab-records').click();
        const panel = page.getByTestId('diagnostics-panel');
        await panel.evaluate((el) => {
          el.open = true;
        });
        await page.getByTestId('diagnostics-geo-test').click();
        const res = page.getByTestId('diagnostics-geo-result');
        // 「取得しています…」(進行中)ではなく最終結果(code=... / 取得成功)が出るまで待つ
        await page.waitForFunction(
          () => {
            const el = document.querySelector('[data-testid="diagnostics-geo-result"]');
            const t = el?.textContent ?? '';
            return t.includes('code=') || t.includes('取得成功');
          },
          null,
          { timeout: 20000 },
        );
        const text = (await res.textContent()) ?? '';
        record(`[${tag}] F. 位置情報 code=${code} → 識別可能な案内`, text.includes(expectText) && text.includes(`code=${code}`), text.slice(0, 60));
      });
    }
    // F2. 成功パスもHTTPS上で（Secure Contextで動作可能）
    await withPage(browserType, opts, async (page) => {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'geolocation', {
          configurable: true,
          value: { getCurrentPosition: (ok) => setTimeout(() => ok({ coords: { latitude: 38.2688, longitude: 140.8721, accuracy: 20 } }), 30) },
        });
      });
      await openApp(page);
      await page.getByTestId('tab-route').click();
      const picker = page.getByTestId('course-mode-auto');
      if (await picker.isVisible().catch(() => false)) await picker.click();
      await page.getByTestId('origin-geo-use').click();
      const label = (await page.getByTestId('origin-label').textContent().catch(() => '')) ?? '';
      record(`[${tag}] F2. コース出発地点: 現在地取得成功`, label.includes('現在地'), label);
    });
  }

  const fails = results.filter((r) => !r.ok);
  console.log('');
  console.log(`=== NAMI FINAL GATE CHECK: ${results.length - fails.length}/${results.length} OK ===`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
