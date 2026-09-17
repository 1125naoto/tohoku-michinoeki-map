import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 1,
  reporter: [['list']],
  use: {
    // IPv4を明示（localhostはIPv6(::1)に解決される環境があり接続経路が曖昧になるため）
    baseURL: 'http://127.0.0.1:4173',
  },
  webServer: {
    command: 'npm run preview',
    url: 'http://127.0.0.1:4173',
    // dist/はGitHub Pagesビルドとこのpreviewサーバーの両方が読み書きしうる共有リソース
    // （Astra監査P1: 過去に「buildとPlaywrightが同時にdist/へ触れて大量の偽陽性失敗を
    // 起こした」実例あり）。この設定自体は「既にpreviewサーバーが動いていれば使い回す」
    // だけで安全だが、構造的にビルドとの競合を避けるため、通常は直接 `npx playwright test`
    // ではなく `npm run e2e`（package.json: `npm run build && playwright test` で
    // ビルド完了後にのみ起動する一体化コマンド）を使うこと。dist/を書き換えるコマンド
    // （npm run build 等）を、このpreviewサーバーが起動中の別プロセスとして同時に
    // 実行しないこと。
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    // スマートフォン優先: 全テストをiPhone相当で実行
    { name: 'iphone', use: { ...devices['iPhone 13'] } },
    // Owner実機（iPhone Safari）で起きた白画面のように、WebKit固有の復帰挙動に依存する
    // 回帰だけを実際のWebKitで確認する（全シナリオは流さない）
    { name: 'webkit-iphone', use: { ...devices['iPhone 13'], browserName: 'webkit' }, grep: /@webkit/ },
    // その他の画面はスモーク+スクリーンショットのみ
    { name: 'android', use: { ...devices['Pixel 5'] }, grep: /@smoke/ },
    { name: 'tablet', use: { ...devices['iPad (gen 7)'] }, grep: /@smoke/ },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, grep: /@smoke/ },
  ],
});
