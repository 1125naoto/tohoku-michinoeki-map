import { CATEGORY_LABEL, CATEGORY_SUBCATEGORIES, SUBCATEGORY_LABEL, type PoiCategory } from '../lib/poi';
import { RADIUS_CHOICES, type SearchRadiusM } from '../lib/overpass';

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
  resultCount: number;
  onGoogleFallback: () => void;
  onClose: () => void;
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
  resultCount,
  onGoogleFallback,
  onClose,
}: Props) {
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
          検索中…
        </p>
      )}
      {!loading && failed && (
        <div className="msg warn" data-testid="poi-failed">
          周辺スポットの検索がうまくいきませんでした。電波状況をご確認のうえ、
          Googleマップで直接検索することもできます。
          <button style={{ marginTop: 6, width: '100%' }} onClick={onGoogleFallback} data-testid="poi-google-fallback">
            🔍 Googleマップで探す
          </button>
        </div>
      )}
      {!loading && !failed && resultCount === 0 && (
        <p className="msg info" data-testid="poi-empty">
          該当情報なし。検索範囲を広げるか、条件を変えてお試しください。
        </p>
      )}
      {!loading && !failed && resultCount > 0 && (
        <p className="msg info" data-testid="poi-result-count" style={{ marginBottom: 0 }}>
          {resultCount}件見つかりました。地図のマークをタップすると詳しく見られます。
        </p>
      )}
    </div>
  );
}
