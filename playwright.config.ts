import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
  },
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    // スマートフォン優先: 全テストをiPhone相当で実行
    { name: 'iphone', use: { ...devices['iPhone 13'] } },
    // その他の画面はスモーク+スクリーンショットのみ
    { name: 'android', use: { ...devices['Pixel 5'] }, grep: /@smoke/ },
    { name: 'tablet', use: { ...devices['iPad (gen 7)'] }, grep: /@smoke/ },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, grep: /@smoke/ },
  ],
});
