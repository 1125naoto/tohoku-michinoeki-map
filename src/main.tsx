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
  /**
   * 操作中の自動再読み込みを避ける。
   * コース作成中・完成コース表示中・旅行中に新しいSWが有効化されると、以前は即座に
   * location.reload() していたため、作りかけの内容や進行中の画面が消えていた。
   * アプリ側が window.__michinoekiBusy を立てている間は延期し、画面が隠れた時・
   * 操作が終わった時に適用する（更新自体はスキップしない）。
   */
  const isBusy = () => (window as unknown as { __michinoekiBusy?: boolean }).__michinoekiBusy === true;
  const applyUpdate = () => {
    if (reloaded) return;
    reloaded = true;
    location.reload();
  };
  const applyWhenIdle = () => {
    if (reloaded) return;
    if (!isBusy()) {
      applyUpdate();
      return;
    }
    // 操作が終わる or 画面を離れるまで待ってから適用する
    const timer = setInterval(() => {
      if (!isBusy()) {
        clearInterval(timer);
        applyUpdate();
      }
    }, 2000);
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.visibilityState === 'hidden') {
          clearInterval(timer);
          applyUpdate();
        }
      },
      { once: true },
    );
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    applyWhenIdle();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then((reg) => {
        // 表示のたびに更新確認（ブラウザ任せにせず明示的にチェック）
        const check = () => reg.update().catch(() => {});
        check();
        // 開きっぱなしのタブにも新ビルドが届くよう、定期+復帰時にも更新確認する。
        // 新SWは skipWaiting+clientsClaim で即時有効化され、controllerchange で
        // このページが1回だけ自動再読み込みされる（手動のキャッシュ削除は不要）。
        setInterval(check, 60 * 1000);
        window.addEventListener('focus', check);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') check();
        });
      })
      .catch(() => {
        /* SW未生成(dev)や未対応環境では黙ってスキップ */
      });
  });
}
