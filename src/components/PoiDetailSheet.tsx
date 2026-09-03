import { useState } from 'react';
import { CATEGORY_LABEL, STAY_MIN_OPTIONS, SUBCATEGORY_LABEL, poiDisplayName, roundStayMin, type Poi } from '../lib/poi';

interface Props {
  poi: Poi;
  /** 検索起点からの距離の表示ラベル（例:「道の駅しちのへから650m」） */
  distanceLabel: string;
  /** ルート選択中の番号（1始まり）。未選択ならnull */
  selectedNumber: number | null;
  stayMin: number;
  onChangeStayMin: (min: number) => void;
  onToggleRoute: () => void;
  onNav: () => void;
  onGoogleSearch: () => void;
  onClose: () => void;
}

/** 距離をm/kmで読みやすく整形 */
function formatDistance(m: number): string {
  if (m < 1000) return `約${Math.round(m / 10) * 10}m`;
  return `約${(m / 1000).toFixed(1)}km`;
}

export default function PoiDetailSheet({
  poi,
  distanceLabel,
  selectedNumber,
  stayMin,
  onChangeStayMin,
  onToggleRoute,
  onNav,
  onGoogleSearch,
  onClose,
}: Props) {
  const [customStay, setCustomStay] = useState('');
  return (
    <section className="sheet poi-detail-sheet" data-testid="poi-detail-sheet" aria-label="周辺スポットの詳細">
      <div className="sheet-grip" />
      <button className="sheet-x" onClick={onClose} aria-label="閉じる" data-testid="poi-detail-close">
        ✕
      </button>
      <h2>
        {selectedNumber != null && <span className="route-select-num poi-detail-num">{selectedNumber}</span>}
        {poiDisplayName(poi)}
      </h2>
      <p className="kana">
        {CATEGORY_LABEL[poi.category]}・{SUBCATEGORY_LABEL[poi.subcategory]}
      </p>
      <p className="addr" data-testid="poi-detail-distance">
        {distanceLabel}（{formatDistance(poi.distanceM)}）
      </p>
      {poi.address && (
        <p className="addr" data-testid="poi-detail-address">
          {poi.address}
        </p>
      )}
      {poi.openingHoursRaw ? (
        <p className="addr" data-testid="poi-detail-hours">
          営業時間: {poi.openingHoursRaw}
        </p>
      ) : (
        <p className="addr" style={{ color: 'var(--text-sub)' }} data-testid="poi-detail-hours-unknown">
          営業時間: 要確認（地図データに記載がありません）
        </p>
      )}

      <div className="field" style={{ marginTop: 10 }}>
        <label>滞在時間</label>
        <div className="seg">
          {STAY_MIN_OPTIONS.map((m) => (
            <button
              key={m}
              className={customStay === '' && stayMin === m ? 'active' : ''}
              onClick={() => {
                setCustomStay('');
                onChangeStayMin(m);
              }}
            >
              {m}分
            </button>
          ))}
        </div>
        <input
          type="number"
          inputMode="numeric"
          min={15}
          max={240}
          step={15}
          placeholder="自分で設定（分）"
          aria-label="滞在時間を分で入力"
          value={customStay}
          onChange={(e) => {
            setCustomStay(e.target.value);
            const raw = Number(e.target.value);
            if (e.target.value !== '' && Number.isFinite(raw)) onChangeStayMin(roundStayMin(raw));
          }}
          style={{ width: '100%', marginTop: 6 }}
        />
      </div>

      <div className="btn-grid" style={{ marginTop: 10 }}>
        <button
          className={selectedNumber != null ? 'btn-danger-ghost' : 'btn-primary'}
          onClick={onToggleRoute}
          data-testid="poi-detail-toggle-route"
        >
          {selectedNumber != null ? '選択を解除' : '➕ ルートに追加'}
        </button>
        <button onClick={onNav} data-testid="poi-detail-nav">
          🧭 ここへナビ
        </button>
        <button onClick={onGoogleSearch} data-testid="poi-detail-google">
          🔍 Googleマップで評価・口コミを見る
        </button>
      </div>
      <p className="msg info" style={{ marginTop: 10 }}>
        評価・口コミはこのアプリには表示していません（OpenStreetMapに評価データが無いため）。
      </p>
      <p style={{ color: 'var(--text-sub)', fontSize: 12, marginTop: 6 }} data-testid="poi-detail-source">
        情報源: OpenStreetMapの登録データ（
        <a href={poi.sourceUrl} target="_blank" rel="noopener noreferrer">
          出典を見る ↗
        </a>
        ）
      </p>
    </section>
  );
}
