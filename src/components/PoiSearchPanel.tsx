import { CATEGORY_LABEL, CATEGORY_SUBCATEGORIES, poiDisplayName, SUBCATEGORY_LABEL, type Poi, type PoiCategory } from '../lib/poi';
import { RADIUS_CHOICES, type SearchRadiusM } from '../lib/overpass';

export type PoiSortMode = 'distance' | 'name' | 'category';

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

interface Props {
  originLabel: string;
  onUseCurrentLocation: () => void;
  onRequestMapPick: () => void;
  mapPickActive: boolean;
  category: PoiCategory | null;
  onChangeCategory: (c: PoiCategory | null) => void;
  /** 'all' | '__rainy__'（雨の日向け・横断フィルタ） | 個別サブカテゴリキー */
  subcategory: string;
  onChangeSubcategory: (s: string) => void;
  radius: SearchRadiusM;
  onChangeRadius: (r: SearchRadiusM) => void;
  loading: boolean;
  failed: boolean;
  /** 現在地の取得に失敗（Overpass通信の失敗とは別扱い。検索自体は始まっていない） */
  geoFailed: boolean;
  resultCount: number;
  /** 新鮮なキャッシュまたは前回成功時の保存結果を表示している間true */
  fromCache: boolean;
  onRetry: () => void;
  onGoogleFallback: () => void;
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
 * 周辺スポット検索パネル（Gate2〜3のUI）。「POI」「Overpass」等の専門用語は
 * 画面に出さず、「周辺スポット」「食べる」「観光」「温泉・休憩」で統一する。
 */
export default function PoiSearchPanel({
  originLabel,
  onUseCurrentLocation,
  onRequestMapPick,
  mapPickActive,
  category,
  onChangeCategory,
  subcategory,
  onChangeSubcategory,
  radius,
  onChangeRadius,
  loading,
  failed,
  geoFailed,
  resultCount,
  fromCache,
  onRetry,
  onGoogleFallback,
  onClose,
  results,
  sort,
  onChangeSort,
  selectedIds,
  onTapResult,
  onToggleSelect,
}: Props) {
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

      <div className="poi-panel-origin">
        <span data-testid="poi-search-origin">{originLabel}の周辺</span>
        <div className="poi-panel-origin-actions">
          <button onClick={onUseCurrentLocation} data-testid="poi-origin-current">
            📍 現在地
          </button>
          <button
            className={mapPickActive ? 'active' : ''}
            onClick={onRequestMapPick}
            data-testid="poi-origin-map"
          >
            🗺️ 地図で指定
          </button>
        </div>
      </div>

      <div className="seg" data-testid="poi-category-tabs">
        <button
          className={category === null ? 'active' : ''}
          onClick={() => onChangeCategory(null)}
          data-testid="poi-category-all"
        >
          すべて
        </button>
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
      </div>

      {category && (
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

      {loading && (
        <p className="msg info" data-testid="poi-loading">
          周辺スポットを探しています…
        </p>
      )}
      {!loading && geoFailed && (
        <div className="msg warn" data-testid="poi-geo-failed">
          現在地を取得できませんでした。位置情報の利用を許可するか、「地図で指定」で探したい場所をタップしてください。
          <div className="btn-grid" style={{ marginTop: 6 }}>
            <button onClick={onUseCurrentLocation} data-testid="poi-geo-retry">
              📍 もう一度試す
            </button>
            <button onClick={onRequestMapPick} data-testid="poi-geo-use-map">
              🗺️ 地図で指定する
            </button>
          </div>
        </div>
      )}
      {!loading && !geoFailed && failed && (
        <div className="msg warn" data-testid="poi-failed">
          周辺情報を取得できませんでした。時間をおいて再検索するか、Googleマップで検索してください。
          <div className="btn-grid" style={{ marginTop: 6 }}>
            <button onClick={onRetry} data-testid="poi-retry">
              🔄 もう一度試す
            </button>
            <button onClick={expandRadius} disabled={radius === RADIUS_CHOICES[RADIUS_CHOICES.length - 1].value} data-testid="poi-expand-radius">
              📏 検索範囲を変更
            </button>
            <button onClick={onGoogleFallback} data-testid="poi-google-fallback">
              🔍 Googleマップで検索
            </button>
          </div>
        </div>
      )}
      {!loading && !geoFailed && !failed && resultCount === 0 && (
        <div className="msg info" data-testid="poi-empty">
          この条件では周辺スポットが見つかりませんでした。距離やカテゴリーを変えて再検索してください。
          <button
            style={{ marginTop: 6, width: '100%' }}
            onClick={expandRadius}
            disabled={radius === RADIUS_CHOICES[RADIUS_CHOICES.length - 1].value}
            data-testid="poi-expand-radius"
          >
            📏 検索範囲を広げる
          </button>
        </div>
      )}
      {!loading && !geoFailed && !failed && resultCount > 0 && (
        <>
          <p className="msg info" data-testid="poi-result-count" style={{ marginBottom: 6 }}>
            {fromCache
              ? '前回取得した周辺スポットを表示しています。'
              : `周辺スポットを${resultCount}件見つけました。`}
            地図のマークまたは下の一覧をタップすると詳しく見られます。
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
