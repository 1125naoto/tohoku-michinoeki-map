/**
 * ビルド識別情報と、配信元との突き合わせ。
 *
 * 「検証したビルド」と「実機が実際に動かしているビルド」が同一であることを
 * 証明できなかったことが、READY判定と実機挙動の食い違いの根本原因だった。
 * そのため、
 *  - 動作中のJSに埋め込まれたビルドID（__BUILD_ID__）
 *  - 配信元が今出しているビルドID（/build-info.json をネットワークから取得）
 * の2つを比較し、端末が古いビルドを動かしている場合はそれを検知できるようにする。
 */

export interface BuildInfo {
  buildId: string;
  branch: string;
  commit: string;
  dirty: boolean;
  buildTime: string;
  /** 'production'（本番/NAMI） | 'qa'。Owner向け診断表示専用（QAビルドか一目で分かるように） */
  environment: string;
  poiDataVersion: string;
  poiDataFiles: number;
}

/** 現在動作しているJSに埋め込まれたビルド情報（vite.config.ts の define 由来） */
export function runningBuildInfo(): BuildInfo {
  return { buildId: __BUILD_ID__, ...__BUILD_INFO__ };
}

/**
 * 配信元が現在出しているビルド情報を取得する。
 * Service Workerのprecache対象外(.json)かつ cache:'no-store' で、必ずネットワークから読む。
 * 取得できない（オフライン等）場合は null。
 */
export async function fetchServedBuildInfo(): Promise<BuildInfo | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}build-info.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<BuildInfo>;
    if (!data || typeof data.buildId !== 'string') return null;
    return data as BuildInfo;
  } catch {
    return null;
  }
}

/**
 * 端末のキャッシュを完全に消して最新ビルドを取り直す（利用者が明示的に押したときだけ実行）。
 * Service Workerの登録解除 → Cache Storage全削除 → 再読み込み。
 * 通常の自動更新（skipWaiting/clientsClaim/controllerchange再読み込み）で追いつけない
 * 端末（古いURLから移動してきた等）の最終手段。
 */
export async function forceRefreshToLatest(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {
    /* noop */
  }
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* noop */
  }
  location.reload();
}
