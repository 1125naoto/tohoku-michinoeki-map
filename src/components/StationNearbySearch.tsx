import { useState } from 'react';
import { CATEGORY_ICON, NEARBY_CATEGORIES, nearbyCategorySearchUrl, municipalityFor } from '../lib/nearbyCategories';
import { CATEGORY_LABEL, type PoiCategory } from '../lib/poi';
import type { Station } from '../types';

interface Props {
  station: Station;
  /** data-testidの接頭辞（同じ画面に複数並ぶため駅ごとに一意にする） */
  testIdPrefix: string;
}

/**
 * コースに入っている道の駅カードから「この駅の周辺を探す」。
 *
 * 周辺スポットパネルと同じカテゴリ定義（lib/nearbyCategories.ts）をそのまま使い、
 * 押すとGoogleマップを「カテゴリ語 + 市区町村」（例:「ラーメン 秋田市」）で開く。
 * 検索語に道の駅名は入れない（道の駅のPlace詳細へ寄ってしまうため）。
 * 外部リンクは既存方針どおりネイティブアンカー（window.open()は使わない）。
 */
export default function StationNearbySearch({ station, testIdPrefix }: Props) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<PoiCategory | null>(null);
  const area = municipalityFor(station);

  return (
    <div className="stop-nearby">
      <button
        type="button"
        className="stop-nearby-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        data-testid={`${testIdPrefix}-nearby-toggle`}
      >
        🔍 この駅の周辺を探す
      </button>
      {open && (
        <div className="stop-nearby-body" data-testid={`${testIdPrefix}-nearby-body`}>
          <div className="seg" style={{ flexWrap: 'wrap' }}>
            {(Object.keys(NEARBY_CATEGORIES) as PoiCategory[]).map((c) => (
              <button
                type="button"
                key={c}
                className={category === c ? 'active' : ''}
                onClick={() => setCategory(category === c ? null : c)}
                data-testid={`${testIdPrefix}-nearby-category-${c}`}
              >
                {CATEGORY_ICON[c]} {CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>
          {category && (
            <>
              <div className="poi-gmaps-cats-chips" style={{ marginTop: 8 }}>
                {NEARBY_CATEGORIES[category].map((sub) => (
                  <a
                    key={sub.key}
                    className="poi-gmaps-cat"
                    href={nearbyCategorySearchUrl(station, sub)}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid={`${testIdPrefix}-nearby-cat-${sub.key}`}
                  >
                    <span className="poi-gmaps-cat-icon" aria-hidden="true">
                      {sub.icon}
                    </span>
                    <span className="poi-gmaps-cat-label">{sub.label}</span>
                  </a>
                ))}
              </div>
              <p className="poi-more-note" style={{ marginTop: 6 }}>
                Googleマップで{area}のカテゴリ検索を開きます（新しいタブ）。
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
