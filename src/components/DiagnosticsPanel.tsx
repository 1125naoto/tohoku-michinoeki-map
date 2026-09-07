import { useEffect, useState } from 'react';
import { fetchServedBuildInfo, forceRefreshToLatest, runningBuildInfo, type BuildInfo } from '../lib/buildInfo';
import { describeGeolocationError } from '../lib/geolocation';

/** 動作診断パネルに渡す、周辺スポット検索の現在状態 */
export interface PoiDiagnostics {
  originLabel: string | null;
  stationId: string | null;
  totalCount: number;
  category: string | null;
  categoryCount: number;
  subcategory: string;
  filteredCount: number;
  fromStaticCache: boolean;
}

interface Props {
  poi: PoiDiagnostics;
}

interface SwState {
  supported: boolean;
  controlled: boolean;
  scope: string | null;
  state: string;
}

interface GeoResult {
  kind: 'idle' | 'running' | 'ok' | 'error';
  text: string;
}

function displayMode(): string {
  if (typeof window === 'undefined') return '不明';
  const nav = navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return 'ホーム画面アプリ（iOS）';
  if (window.matchMedia?.('(display-mode: standalone)').matches) return 'ホーム画面アプリ';
  return 'ブラウザ';
}

/**
 * 動作診断（実機トラブル時に、この画面のスクリーンショット1枚で
 * 「どのビルドを動かしているか」「位置情報が使える環境か」「SWの状態」「POIの件数」が分かる）。
 * 通常操作の邪魔にならないよう、保存タブの一番下に折りたたみで置く。
 */
export default function DiagnosticsPanel({ poi }: Props) {
  const running = runningBuildInfo();
  const [served, setServed] = useState<BuildInfo | null | 'loading'>('loading');
  const [sw, setSw] = useState<SwState>({ supported: false, controlled: false, scope: null, state: '未確認' });
  const [permission, setPermission] = useState<string>('不明');
  const [geo, setGeo] = useState<GeoResult>({ kind: 'idle', text: '' });
  const [online, setOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [refreshing, setRefreshing] = useState(false);

  const refreshServed = () => {
    setServed('loading');
    void fetchServedBuildInfo().then(setServed);
  };

  useEffect(() => {
    refreshServed();
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      setSw({ supported: false, controlled: false, scope: null, state: '非対応' });
      return;
    }
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => {
        const active = reg?.active?.state ?? null;
        const waiting = reg?.waiting ? '（更新待ち）' : '';
        const installing = reg?.installing ? '（インストール中）' : '';
        setSw({
          supported: true,
          controlled: navigator.serviceWorker.controller != null,
          scope: reg?.scope ?? null,
          state: reg ? `${active ?? '未登録'}${waiting}${installing}` : '未登録',
        });
      })
      .catch(() => setSw({ supported: true, controlled: false, scope: null, state: '取得失敗' }));
  }, []);

  useEffect(() => {
    const nav = navigator as Navigator & { permissions?: Permissions };
    if (!nav.permissions?.query) {
      setPermission('取得不可（この端末では確認できません）');
      return;
    }
    nav.permissions
      .query({ name: 'geolocation' as PermissionName })
      .then((st) => setPermission(st.state))
      .catch(() => setPermission('取得不可'));
  }, []);

  const tryGeolocation = () => {
    setGeo({ kind: 'running', text: '現在地を取得しています…' });
    if (!('geolocation' in navigator)) {
      setGeo({ kind: 'error', text: 'この端末では位置情報APIを使えません' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setGeo({
          kind: 'ok',
          text: `取得成功: ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}（精度 約${Math.round(pos.coords.accuracy)}m）`,
        }),
      (err) =>
        setGeo({
          kind: 'error',
          text: `${describeGeolocationError(err)} [code=${err.code} message=${err.message}]`,
        }),
      { timeout: 15000 },
    );
  };

  const isSecure = typeof window !== 'undefined' ? window.isSecureContext : false;
  const servedId = served === 'loading' ? null : served?.buildId ?? null;
  const stale = servedId != null && servedId !== running.buildId;
  const poiDataMismatch =
    served !== 'loading' && served != null && served.poiDataVersion !== running.poiDataVersion;

  const rows: [string, string][] = [
    ['動作中のビルド', running.buildId],
    ['ブランチ / commit', `${running.branch} / ${running.commit}${running.dirty ? ' (+未コミット変更あり)' : ''}`],
    ['ビルド日時', running.buildTime],
    ['POIデータ版（動作中）', `${running.poiDataVersion}（${running.poiDataFiles}駅）`],
    [
      '配信元のビルド',
      served === 'loading' ? '確認中…' : served == null ? '取得できませんでした（オフライン or 配信停止）' : served.buildId,
    ],
    [
      'POIデータ版（配信元）',
      served === 'loading' ? '確認中…' : served == null ? '不明' : `${served.poiDataVersion}（${served.poiDataFiles}駅）`,
    ],
    ['オンライン', online ? 'はい' : 'いいえ'],
    ['表示形態', displayMode()],
    ['接続', `${typeof location !== 'undefined' ? location.protocol : '?'}//${typeof location !== 'undefined' ? location.hostname : '?'}`],
    ['Secure Context', isSecure ? 'はい（位置情報を使えます）' : 'いいえ（HTTP接続のため位置情報は使えません）'],
    ['位置情報API', typeof navigator !== 'undefined' && 'geolocation' in navigator ? 'あり' : 'なし'],
    ['位置情報の許可状態', permission],
    ['Service Worker', sw.supported ? `${sw.state}${sw.controlled ? '・このページを制御中' : '・未制御'}` : '非対応'],
    ['SWスコープ', sw.scope ?? '—'],
    ['周辺スポット 検索地点', poi.originLabel ?? '未選択'],
    ['周辺スポット 駅ID', poi.stationId ?? '—'],
    ['周辺スポット データ源', poi.fromStaticCache ? '事前キャッシュ/前回結果' : 'ライブ取得 or 未検索'],
    ['周辺スポット 総件数', String(poi.totalCount)],
    ['周辺スポット カテゴリ', `${poi.category ?? 'すべて'}（${poi.categoryCount}件）`],
    ['周辺スポット 細分類', `${poi.subcategory}（表示中 ${poi.filteredCount}件）`],
  ];

  return (
    <details className="card" style={{ marginTop: 16 }} data-testid="diagnostics-panel">
      <summary style={{ cursor: 'pointer', fontWeight: 600 }} data-testid="diagnostics-toggle">
        🔧 動作診断（不具合報告用）
      </summary>
      <p className="msg info" style={{ marginTop: 8, fontSize: 12 }}>
        うまく動かないときは、この画面のスクリーンショットを送ってください。
      </p>
      {stale && (
        <div className="msg warn" style={{ marginTop: 8 }} data-testid="diagnostics-stale">
          この端末は古い版（{running.buildId}）を動かしています。配信元は {servedId} です。
          下の「最新版に更新」を押してください。
        </div>
      )}
      {!stale && served !== 'loading' && served != null && (
        <div className="msg info" style={{ marginTop: 8 }} data-testid="diagnostics-uptodate">
          ✅ 配信元と同じ最新版を動かしています。
        </div>
      )}
      {poiDataMismatch && (
        <div className="msg warn" style={{ marginTop: 8 }} data-testid="diagnostics-poi-mismatch">
          周辺スポットのデータ版が配信元と異なります（古いデータを表示している可能性）。「最新版に更新」を押してください。
        </div>
      )}
      <table style={{ width: '100%', fontSize: 12, marginTop: 8, borderCollapse: 'collapse' }} data-testid="diagnostics-table">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th style={{ textAlign: 'left', padding: '3px 6px 3px 0', whiteSpace: 'nowrap', verticalAlign: 'top', fontWeight: 600 }}>{k}</th>
              <td style={{ padding: '3px 0', wordBreak: 'break-all' }} data-testid={`diag-${k}`}>
                {v}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="btn-grid" style={{ marginTop: 10 }}>
        <button onClick={tryGeolocation} disabled={geo.kind === 'running'} data-testid="diagnostics-geo-test">
          📍 現在地を取得してみる
        </button>
        <button onClick={refreshServed} data-testid="diagnostics-recheck">
          🔄 配信元を再確認
        </button>
        <button
          className="btn-danger-ghost"
          disabled={refreshing}
          onClick={() => {
            setRefreshing(true);
            void forceRefreshToLatest();
          }}
          data-testid="diagnostics-force-refresh"
        >
          ⬆️ 最新版に更新（キャッシュを消して再読み込み）
        </button>
      </div>
      {geo.kind !== 'idle' && (
        <p className={`msg ${geo.kind === 'error' ? 'warn' : 'info'}`} style={{ marginTop: 8 }} data-testid="diagnostics-geo-result">
          {geo.text}
        </p>
      )}
    </details>
  );
}
