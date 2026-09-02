import React from 'react';
import ReactDOM from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import './styles.css';
import App from './App';
import { STATIONS } from './data';

// E2Eテスト・デバッグ用に駅ID一覧を公開（個人情報は含まない）
(window as unknown as { __stationIds: string[] }).__stationIds = STATIONS.map((s) => s.id);

/** 保存データが壊れていても画面全体を落とさないための最終防壁 */
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="error-screen" data-testid="error-screen">
          <h2>問題が発生しました</h2>
          <p>画面を再読み込みしてください。改善しない場合は「記録」タブ相当のデータ初期化が必要な可能性があります。</p>
          <button className="btn-primary" onClick={() => location.reload()}>
            再読み込み
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

// PWA Service Worker 登録（vite-plugin-pwa が生成）
// 更新方針: 新しいSWは skipWaiting+clientsClaim で即時有効化され、
// 制御が切り替わった瞬間にページを1回だけ自動再読み込みする。
// これにより古いprecache（旧アイコン等）が表示され続けることを防ぎ、
// ユーザーに手動のキャッシュ削除を求めない。
if ('serviceWorker' in navigator) {
  // 読み込み時点で既にSWの制御下だったページだけを対象にする
  // （初回インストール時のclients.claimでは再読み込みしない）
  const hadController = navigator.serviceWorker.controller != null;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then((reg) => {
        // 表示のたびに更新確認（ブラウザ任せにせず明示的にチェック）
        reg.update().catch(() => {});
      })
      .catch(() => {
        /* SW未生成(dev)や未対応環境では黙ってスキップ */
      });
  });
}
