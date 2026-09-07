import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages（プロジェクトページ）ではサブパス配信になるため、ビルド時の環境変数で切り替える。
// ローカルのプレビュー/開発サーバーでは未設定=ルート('/')のまま。
const DEPLOY_BASE = process.env.DEPLOY_BASE ?? '/';
const iconPath = (p: string) => `${DEPLOY_BASE}${p}`.replace(/\/{2,}/g, '/');

export default defineConfig({
  base: DEPLOY_BASE,
  test: {
    // E2E (Playwright) は vitest の対象外
    include: ['src/**/*.test.ts'],
  },
  plugins: [
    react(),
    VitePWA({
      // 新しいビルドを検知したら自動更新（古い道の駅データが永久に残らない）
      registerType: 'autoUpdate',
      injectRegister: false, // main.tsx で手動登録
      filename: 'sw.js',
      manifest: {
        name: '道の駅ナビ｜東北スタンプラリー＆ルート検索',
        short_name: '道の駅ナビ',
        description: '東北6県の道の駅を記録し、周辺の飲食店・観光・温泉を組み合わせたドライブコースを作れるルート検索アプリ',
        lang: 'ja',
        start_url: DEPLOY_BASE,
        scope: DEPLOY_BASE,
        display: 'standalone',
        background_color: '#f7f8f5',
        theme_color: '#2e7d32',
        icons: [
          { src: iconPath('icons/icon-48.png'), sizes: '48x48', type: 'image/png' },
          { src: iconPath('icons/icon-72.png'), sizes: '72x72', type: 'image/png' },
          { src: iconPath('icons/icon-96.png'), sizes: '96x96', type: 'image/png' },
          { src: iconPath('icons/icon-128.png'), sizes: '128x128', type: 'image/png' },
          { src: iconPath('icons/icon-144.png'), sizes: '144x144', type: 'image/png' },
          { src: iconPath('icons/icon-152.png'), sizes: '152x152', type: 'image/png' },
          { src: iconPath('icons/icon-192.png'), sizes: '192x192', type: 'image/png' },
          { src: iconPath('icons/icon-384.png'), sizes: '384x384', type: 'image/png' },
          { src: iconPath('icons/icon-512.png'), sizes: '512x512', type: 'image/png' },
          {
            src: iconPath('icons/icon-512-maskable.png'),
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // 新しいSWを待機させず即時有効化し、開いているページも即座に制御下へ。
        // 古いprecacheは削除（古いアイコン等が配信され続けるのを防ぐ）
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // アプリ本体+道の駅データ(JSにバンドル)をプリキャッシュ → オフラインで一覧閲覧可
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        navigateFallback: iconPath('index.html'),
        runtimeCaching: [
          {
            // OSMタイル: 直近に見た範囲だけキャッシュ（オフラインでは表示不可の旨をUIで案内）
            urlPattern: /^https:\/\/tile\.openstreetmap\.org\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'osm-tiles',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 14 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // 住所検索はオンライン専用
            urlPattern: /^https:\/\/msearch\.gsi\.go\.jp\/.*/,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
  },
  preview: {
    // 実機テスト用のLAN/HTTPSトンネル（Cloudflare Tunnel等）はランダムなホスト名で
    // アクセスしてくるため、DNSリバインディング対策のHostチェックを無効化する。
    // vite previewはローカルの実機テスト専用で、本番のGitHub Pages配信（静的ビルド出力を
    // そのまま配信するだけ）には一切関与しないため安全。
    allowedHosts: true,
  },
});
