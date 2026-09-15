import { useState } from 'react';
import { CATEGORY_LABEL, CATEGORY_SUBCATEGORIES, GOOGLE_DETAIL_KEYWORD, poiDisplayName, SUBCATEGORY_LABEL, type Poi, type PoiCategory, type PoiSubcategory } from '../lib/poi';
import { RADIUS_CHOICES, type EndpointAttemptLog, type SearchRadiusM } from '../lib/overpass';
import { PREFECTURES, type Prefecture, type Station } from '../types';
import { isDiagnosticsHost } from '../lib/geolocation';

export type PoiSortMode = 'distance' | 'name' | 'category';
export type PoiOriginMode = 'station' | 'current' | 'route';

const OUTCOME_LABEL: Record<EndpointAttemptLog['outcome'], string> = {
  ok: 'OK',
  http_error: 'HTTPエラー',
  timeout: 'タイムアウト',
  network_error: '通信エラー',
  aborted: '他が先に成功（未使用）',
  malformed: '応答異常（実行時エラー等）',
};

/** 一覧の並び順（近い順が既定）。OSMには評価データが無いため「評価順」は用意しない */
export function sortPois(pois: Poi[], mode: PoiSortMode): Poi[] {
  const sorted = [...pois];
  if (mode === 'name') {
    sorted.sort((a, b) => poiDisplayName(a).localeCompare(poiDisplayName(b), 'ja'));
  } else if (mode === 'category') {
    sorted.sort((a, b) => {
      if (a.category !== b.category) return CATEGORY_LABEL[a.category].localeCompare(CATEGORY_LABEL[b.category], 'ja');
      return a.distanceM - b.distanceM;
    });
  } else {
    sorted.sort((a, b) => a.distanceM - b.distanceM);
  }
  return sorted;
}

function formatDistance(m: number): string {
  if (m < 1000) return `約${Math.round(m / 10) * 10}m`;
  return `約${(m / 1000).toFixed(1)}km`;
}

interface RouteStopOption {
  id: string;
  label: string;
  lat: number;
  lng: number;
  name: string;
}

interface Props {
  stations: Station[];
  origin: { lat: number; lng: number; label: string } | null;
  originMode: PoiOriginMode;
  onChangeOriginMode: (m: PoiOriginMode) => void;
  onPickStation: (st: Station) => void;
  onUseCurrentLocation: () => void;
  geolocationStatus: 'idle' | 'requesting' | 'denied' | 'ok';
  routeStopOptions: RouteStopOption[];
  onPickRouteStop: (s: RouteStopOption) => void;
  category: PoiCategory | null;
  onChangeCategory: (c: PoiCategory | null) => void;
  /** 'all' | '__rainy__'（雨の日向け・横断フィルタ） | 個別サブカテゴリキー */
  subcategory: string;
  onChangeSubcategory: (s: string) => void;
  radius: SearchRadiusM;
  onChangeRadius: (r: SearchRadiusM) => void;
  /** 検索地点が選択済みで「この周辺を検索」を押せる状態か */
  canSearch: boolean;
  onSearch: () => void;
  loading: boolean;
  failed: boolean;
  /** 現在地の取得に失敗した場合の案内文（Overpass通信の失敗とは別扱い。検索自体は始まっていない） */
  geoErrorMessage: string | null;
  /** 一度でも検索を実行したか（まだ一度もしていなければ結果0件でも「見つかりませんでした」は出さない） */
  searched: boolean;
  resultCount: number;
  /** カテゴリ絞り込み前の総件数（0件がカテゴリ絞り込みのせいか、本当に周辺に無いのかの判定用） */
  totalRawCount: number;
  /** 現在のカテゴリのみで絞った件数（細分類だけが0件なのか、カテゴリ自体が0件なのかの判定用） */
  categoryRawCount: number;
  /** 結果が少なく自動的に検索範囲を広げた場合true */
  autoExpanded: boolean;
  /** 新鮮なキャッシュまたは前回成功時の保存結果を表示している間true */
  fromCache: boolean;
  /** stale-while-revalidate: キャッシュを表示しつつ裏で最新データを取得中の間true */
  revalidating: boolean;
  /** 直近の検索の接続先ごとの試行ログ（診断表示専用） */
  attemptLog: EndpointAttemptLog[];
  /** trueなら食べる(food)系カテゴリの取得が不完全（0件表示でも「周辺に無い」と断定しない） */
  foodIncomplete: boolean;
  /** trueなら温泉・観光・宿泊等(other)系カテゴリの取得が不完全 */
  otherIncomplete: boolean;
  onRetry: () => void;
  onGoogleFallback: () => void;
  /** 「Googleマップでもっと探す」（常時表示のCTA。検索実行前でも検索地点さえあれば押せる） */
  onGoogleDetailSearch: () => void;
  onClose: () => void;
  /** 一覧表示する検索結果（表示用に既にフィルタ済み） */
  results: Poi[];
  sort: PoiSortMode;
  onChangeSort: (s: PoiSortMode) => void;
  /** ルートに選択済みのID（周辺スポットの選択番号表示用） */
  selectedIds: string[];
  onTapResult: (p: Poi) => void;
  onToggleSelect: (p: Poi) => void;
}

/**
 * 周辺スポット検索パネル。「POI」「Overpass」「nwr」等の専門用語は画面に出さず、
 * 「周辺スポット」「食べる」「観光」「温泉・休憩」で統一する。
 *
 * 重要: パネルを開いた時点・検索地点を選んだ時点では通信を開始しない。
 * 「この周辺を検索」を押して初めて通信を開始する（Gate1〜3）。
 */
export default function PoiSearchPanel({
  stations,
  origin,
  originMode,
  onChangeOriginMode,
  onPickStation,
  onUseCurrentLocation,
  geolocationStatus,
  routeStopOptions,
  onPickRouteStop,
  category,
  onChangeCategory,
  subcategory,
  onChangeSubcategory,
  radius,
  onChangeRadius,
  canSearch,
  onSearch,
  loading,
  failed,
  geoErrorMessage,
  searched,
  resultCount,
  totalRawCount,
  categoryRawCount,
  autoExpanded,
  fromCache,
  revalidating,
  attemptLog,
  foodIncomplete,
  otherIncomplete,
  onRetry,
  onGoogleFallback,
  onGoogleDetailSearch,
  onClose,
  results,
  sort,
  onChangeSort,
  selectedIds,
  onTapResult,
  onToggleSelect,
}: Props) {
  // 「道の駅を選ぶ」内の都道府県絞り込み。検索地点そのものではなく一覧の見た目だけを絞る
  // ローカルなUI状態のため、検索地点state（origin）やPOI検索ロジックには一切影響しない。
  const [prefFilter, setPrefFilter] = useState<Prefecture>(PREFECTURES[0]);
  const expandRadius = () => {
    const idx = RADIUS_CHOICES.findIndex((r) => r.value === radius);
    const next = RADIUS_CHOICES[idx + 1];
    if (next) onChangeRadius(next.value);
  };
  return (
    <div className="poi-panel" data-testid="poi-search-panel">
      <div className="poi-panel-head">
        <h3>周辺スポットを探す</h3>
        <button aria-label="検索を終了" onClick={onClose} data-testid="poi-panel-close">
          ✕
        </button>
      </div>

      <div className="seg" data-testid="poi-origin-tabs" style={{ flexWrap: 'wrap' }}>
        <button
          className={originMode === 'station' ? 'active' : ''}
          onClick={() => onChangeOriginMode('station')}
          data-testid="poi-origin-mode-station"
        >
          道の駅を選ぶ
        </button>
        <button
          className={originMode === 'current' ? 'active' : ''}
          onClick={() => onChangeOriginMode('current')}
          data-testid="poi-origin-mode-current"
        >
          現在地
        </button>
        {routeStopOptions.length > 0 && (
          <button
            className={originMode === 'route' ? 'active' : ''}
            onClick={() => onChangeOriginMode('route')}
            data-testid="poi-origin-mode-route"
          >
            ルート上の立ち寄り先
          </button>
        )}
      </div>

      {originMode === 'station' && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ marginBottom: 6 }}>
            <span className="poi-radius-label">都道府県</span>
            <select
              style={{ width: '100%', marginTop: 4 }}
              aria-label="都道府県で絞り込む"
              value={prefFilter}
              onChange={(e) => setPrefFilter(e.target.value as Prefecture)}
              data-testid="poi-origin-pref-select"
            >
              {PREFECTURES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="poi-radius-label">道の駅</span>
            <select
              style={{ width: '100%', marginTop: 4 }}
              aria-label="検索する道の駅"
              value=""
              onChange={(e) => {
                const st = stations.find((s) => s.id === e.target.value);
                if (st) onPickStation(st);
              }}
              data-testid="poi-origin-station-select"
            >
              <option value="">道の駅を選択…</option>
              {stations
                .filter((s) => s.pref === prefFilter)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}（{s.city}）
                  </option>
                ))}
            </select>
          </div>
        </div>
      )}

      {originMode === 'current' && (
        <div style={{ marginBottom: 8 }}>
          <button className="btn-primary" style={{ width: '100%' }} onClick={onUseCurrentLocation} data-testid="poi-origin-current">
            📍 現在地を取得
          </button>
          {geolocationStatus === 'requesting' && (
            <p className="msg info" style={{ marginTop: 6 }}>
              現在地を確認しています…
            </p>
          )}
          {geoErrorMessage && (
            <div className="msg warn" style={{ marginTop: 6 }} data-testid="poi-geo-failed">
              {geoErrorMessage}
              <div className="btn-grid" style={{ marginTop: 6 }}>
                <button onClick={onUseCurrentLocation} data-testid="poi-geo-retry">
                  📍 もう一度試す
                </button>
                <button onClick={() => onChangeOriginMode('station')} data-testid="poi-geo-use-station">
                  道の駅を選ぶ
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {originMode === 'route' && routeStopOptions.length > 0 && (
        <div className="seg" style={{ flexWrap: 'wrap', marginBottom: 8 }} data-testid="poi-origin-route-list">
          {routeStopOptions.map((s) => (
            <button key={s.id} onClick={() => onPickRouteStop(s)} data-testid={`poi-origin-route-${s.id}`}>
              {s.label}
            </button>
          ))}
        </div>
      )}

      <p className="poi-origin-current" data-testid="poi-search-origin">
        検索地点：<b>{origin ? origin.label : '未選択'}</b>
      </p>

      <div className="seg" data-testid="poi-category-tabs">
        {(Object.keys(CATEGORY_LABEL) as PoiCategory[]).map((c) => (
          <button
            key={c}
            className={category === c ? 'active' : ''}
            onClick={() => onChangeCategory(c)}
            data-testid={`poi-category-${c}`}
          >
            {CATEGORY_LABEL[c]}
          </button>
        ))}
        <button
          className={category === null ? 'active' : ''}
          onClick={() => onChangeCategory(null)}
          data-testid="poi-category-all"
        >
          すべて
        </button>
      </div>

      {/*
        道の駅ナビ＝発見・車旅・旅程作成、Googleマップ＝網羅的な詳細探索・口コミ・
        写真・営業時間・ナビ、という役割分担のCTA。大分類を押した瞬間にGoogleマップへ
        飛ばすのではなく、アプリ内候補（下の一覧）とは別に「さらに探したい場合は
        こちら」という二段構造にする。検索を実行していなくても、検索地点さえ決まって
        いれば押せる（Overpass通信には依存しない）。
      */}
      {origin && (
        <button
          style={{ width: '100%', marginTop: 6 }}
          onClick={onGoogleDetailSearch}
          data-testid="poi-google-detail-search"
        >
          🔍 Googleマップでもっと{category ? GOOGLE_DETAIL_KEYWORD[category] : '周辺スポット'}を探す
        </button>
      )}

      {/*
        食べる(food)の細分類（ラーメン/食堂/洋食/寿司/焼肉等）は、一般ユーザーUIから
        原則撤去する（公開前UX整理）。「このボタンを押せば周辺の該当店舗が網羅的に
        表示される」という誤解を生むため。OSMデータの登録・タグ品質・網羅率には
        構造上Google Maps相当の網羅性を期待できず、そこを埋めようとはしない方針
        （道の駅ナビの目的は発見・車旅・ルート作成であり、全国グルメDBではない）。
        内部classificationロジック・POIデータ自体は変更しない（一覧の各行には
        引き続きジャンルをテキストで表示する）。他カテゴリ(観光/温泉/宿泊)の
        細分類は従来どおり残す。
      */}
      {category && category !== 'food' && (
        <div className="poi-subcats" data-testid="poi-subcategory-chips">
          <button className={subcategory === 'all' ? 'active' : ''} onClick={() => onChangeSubcategory('all')}>
            すべて
          </button>
          {category === 'tourism' && (
            <button
              className={subcategory === '__rainy__' ? 'active' : ''}
              onClick={() => onChangeSubcategory('__rainy__')}
              data-testid="poi-subcategory-rainy"
              title="博物館・動物園水族館・温泉など屋内で楽しめる場所をまとめて絞り込みます"
            >
              雨の日向け
            </button>
          )}
          {CATEGORY_SUBCATEGORIES[category].map((s) => (
            <button
              key={s}
              className={subcategory === s ? 'active' : ''}
              onClick={() => onChangeSubcategory(s)}
              data-testid={`poi-subcategory-${s}`}
            >
              {SUBCATEGORY_LABEL[s]}
            </button>
          ))}
        </div>
      )}

      <div className="poi-radius" data-testid="poi-radius-chips">
        <span className="poi-radius-label">検索範囲</span>
        <div className="seg">
          {RADIUS_CHOICES.map((r) => (
            <button
              key={r.value}
              className={radius === r.value ? 'active' : ''}
              onClick={() => onChangeRadius(r.value)}
              data-testid={`poi-radius-${r.value}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <button
        className="btn-primary"
        style={{ width: '100%', minHeight: 48, fontSize: 15, marginTop: 4 }}
        disabled={!canSearch || loading}
        onClick={onSearch}
        data-testid="poi-do-search"
      >
        🔍 この周辺を検索
      </button>
      {!canSearch && (
        <p className="msg info" style={{ marginTop: 6 }}>
          検索地点を選んでください。
        </p>
      )}

      {loading && (
        <p className="msg info" data-testid="poi-loading" style={{ marginTop: 8 }}>
          周辺スポットを探しています…
        </p>
      )}
      {!loading && !failed && searched && resultCount === 0 && (
        <div className="msg info" style={{ marginTop: 8 }} data-testid="poi-empty">
          {/* 実機で「ラーメン」等の細分類が0件のとき「食べる自体が0件」と誤表示され紛らわしいと
              判明したため、細分類だけが0件のケース（カテゴリ自体には結果がある）を区別する。
              さらに、該当カテゴリのOverpass取得自体が不完全(foodIncomplete/otherIncomplete)な
              場合は「周辺に無い」と断定せず、取得できなかった旨を案内する（B3/Astra P1）。 */}
          {(category === 'food' ? foodIncomplete : category ? otherIncomplete : foodIncomplete || otherIncomplete) ? (
            <div data-testid="poi-empty-incomplete">
              {category
                ? `「${CATEGORY_LABEL[category]}」の情報を取得できませんでした。周辺に無いとは限りません。`
                : '一部のカテゴリの情報を取得できませんでした。周辺に無いとは限りません。'}
            </div>
          ) : category && subcategory !== 'all' && categoryRawCount > 0 ? (
            <>
              {`「${subcategory === '__rainy__' ? '雨の日向け' : SUBCATEGORY_LABEL[subcategory as PoiSubcategory]}」では見つかりませんでした。「${CATEGORY_LABEL[category]}」の他の絞り込みでは${categoryRawCount}件見つかっています。`}
            </>
          ) : category && totalRawCount > 0 ? (
            <>
              「{CATEGORY_LABEL[category]}」では見つかりませんでした。他のカテゴリでは{totalRawCount}
              件見つかっています。
            </>
          ) : (
            <>この範囲では周辺スポットが見つかりませんでした。</>
          )}
          <div className="btn-grid" style={{ marginTop: 6 }}>
            {category && subcategory !== 'all' && categoryRawCount > 0 && (
              <button onClick={() => onChangeSubcategory('all')} data-testid="poi-show-all-subcategories">
                🔎 「{CATEGORY_LABEL[category]}」の他のジャンルを見る
              </button>
            )}
            {category && totalRawCount > 0 && (
              <button onClick={() => onChangeCategory(null)} data-testid="poi-show-all-categories">
                🔎 すべてのカテゴリを見る
              </button>
            )}
            <button
              onClick={expandRadius}
              disabled={radius === RADIUS_CHOICES[RADIUS_CHOICES.length - 1].value}
              data-testid="poi-expand-radius"
            >
              📏 範囲を広げて探す
            </button>
            <button onClick={onGoogleFallback} data-testid="poi-empty-google-fallback">
              🔍 Googleマップで探す
            </button>
          </div>
        </div>
      )}
      {!loading && failed && (
        <div className="msg warn" style={{ marginTop: 8 }} data-testid="poi-failed">
          周辺情報を取得できませんでした。もう一度試すか、Googleマップで検索してください。
          <div className="btn-grid" style={{ marginTop: 6 }}>
            <button onClick={onRetry} data-testid="poi-retry">
              🔄 もう一度試す
            </button>
            <button onClick={expandRadius} disabled={radius === RADIUS_CHOICES[RADIUS_CHOICES.length - 1].value} data-testid="poi-expand-radius">
              📏 条件を変更
            </button>
            <button onClick={onGoogleFallback} data-testid="poi-google-fallback">
              🔍 Googleマップで検索
            </button>
          </div>
        </div>
      )}
      {!loading && searched && (failed || resultCount === 0) && isDiagnosticsHost() && (
        <details className="msg info" style={{ marginTop: 8, fontSize: 12 }} data-testid="poi-diagnostics">
          <summary>🔧 診断情報（開発/検証環境のみ表示）</summary>
          <div style={{ marginTop: 6 }}>
            <div>カテゴリー: {category ? CATEGORY_LABEL[category] : 'すべて'} / 検索範囲: {radius}m</div>
            {attemptLog.length === 0 && <div>（試行ログなし。キャッシュ由来の結果か、検索が始まっていません）</div>}
            {attemptLog.map((a, i) => (
              <div key={i}>
                [{a.radiusM}m] {a.url.replace('https://', '').replace('/api/interpreter', '').replace('/osm/tools/overpass', '')}
                {' → '}
                {OUTCOME_LABEL[a.outcome]}
                {a.status != null ? ` (HTTP ${a.status})` : ''}
                {a.elementCount != null ? ` / ${a.elementCount}件` : ''}
              </div>
            ))}
          </div>
        </details>
      )}
      {!loading && !failed && resultCount > 0 && (
        <>
          <p className="msg info" data-testid="poi-result-count" style={{ marginTop: 8, marginBottom: 6 }}>
            {autoExpanded && (
              <>
                結果が少なかったため、検索範囲を自動的に
                {RADIUS_CHOICES.find((r) => r.value === radius)?.label ?? `${radius / 1000}km`}
                まで広げました。
                <br />
              </>
            )}
            {fromCache
              ? '前回取得した周辺スポットを表示しています。'
              : `周辺の主なスポットを${resultCount}件見つけました。`}
            地図のマークまたは下の一覧をタップすると詳しく見られます。
            {revalidating && (
              <>
                <br />
                <span data-testid="poi-revalidating">🔄 最新の情報を確認しています…</span>
              </>
            )}
            {!fromCache && (foodIncomplete || otherIncomplete) && (
              <>
                <br />
                <span data-testid="poi-partial-warning">
                  ⚠️ {foodIncomplete && otherIncomplete
                    ? '一部カテゴリ'
                    : foodIncomplete
                      ? '「食べる」'
                      : '「観光・温泉等」'}
                  の情報を取得できませんでした。表示件数は実際より少ない可能性があります。
                </span>
              </>
            )}
          </p>
          <div className="poi-sort" data-testid="poi-sort">
            <span className="poi-radius-label">並び順</span>
            <div className="seg">
              <button className={sort === 'distance' ? 'active' : ''} onClick={() => onChangeSort('distance')} data-testid="poi-sort-distance">
                近い順
              </button>
              <button className={sort === 'name' ? 'active' : ''} onClick={() => onChangeSort('name')} data-testid="poi-sort-name">
                名前順
              </button>
              <button className={sort === 'category' ? 'active' : ''} onClick={() => onChangeSort('category')} data-testid="poi-sort-category">
                カテゴリー別
              </button>
            </div>
          </div>
          <ul className="poi-result-list" data-testid="poi-result-list">
            {results.map((p) => {
              const num = selectedIds.indexOf(p.id);
              return (
                <li key={p.id} className="poi-result-row" data-testid="poi-result-row">
                  <button className="poi-result-main" onClick={() => onTapResult(p)} data-testid="poi-result-open">
                    {num >= 0 && <span className="route-select-num">{num + 1}</span>}
                    <span className="poi-result-text">
                      <b>{poiDisplayName(p)}</b>
                      <span className="poi-result-meta">
                        {CATEGORY_LABEL[p.category]}・{SUBCATEGORY_LABEL[p.subcategory]}・{formatDistance(p.distanceM)}
                      </span>
                      {p.address && <span className="poi-result-meta">{p.address}</span>}
                      {p.openingHoursRaw && <span className="poi-result-meta">営業時間: {p.openingHoursRaw}</span>}
                    </span>
                  </button>
                  <button
                    className={num >= 0 ? 'btn-danger-ghost' : ''}
                    onClick={() => onToggleSelect(p)}
                    aria-label={num >= 0 ? '選択を解除' : 'ルートに追加'}
                    data-testid="poi-result-toggle"
                  >
                    {num >= 0 ? '✓' : '➕'}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
