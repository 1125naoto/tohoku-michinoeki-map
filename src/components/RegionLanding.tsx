import { useState } from 'react';
import PrefectureChipGroups from './PrefectureChipGroups';
import type { AreaStat, PrefStat } from '../lib/stats';
import type { SelectedPrefectures } from '../lib/ui';
import type { AreaName, Prefecture } from '../types';

interface Props {
  areas: AreaStat[];
  statByPref: Map<Prefecture, PrefStat>;
  /** 収録されている道の駅の総数（「全国を見る」の説明に使う） */
  totalStations: number;
  selectedPrefectures: SelectedPrefectures;
  onSelectArea: (area: AreaName) => void;
  onTogglePrefecture: (pref: Prefecture) => void;
  /** 「都道府県から選ぶ」で選んだ内容を確定して地図へ進む */
  onConfirmPrefectures: () => void;
  onSelectNationwide: () => void;
  /** 地図から「地域を変更」で開いた場合のみ、選び直さずに戻れる。初回起動時はnull */
  onCancel: (() => void) | null;
}

/**
 * 「どこを旅しますか？」— 初回起動（および「地域を変更」）の入口画面。
 *
 * 全国1,237施設を最初から地図に出すと初見では情報量が多すぎるため、まず地方を選んで
 * もらう。地方・都道府県の定義は types.ts（AREAS / AREA_BY_PREFECTURE）を唯一の
 * 出どころとし、この画面では二重管理しない。既存の複数都道府県選択も
 * 「都道府県から選ぶ」から同じUI（PrefectureChipGroups）で利用できる。
 */
export default function RegionLanding({
  areas,
  statByPref,
  totalStations,
  selectedPrefectures,
  onSelectArea,
  onTogglePrefecture,
  onConfirmPrefectures,
  onSelectNationwide,
  onCancel,
}: Props) {
  const [prefOpen, setPrefOpen] = useState(false);

  return (
    <div className="region-landing" data-testid="region-landing">
      <div className="region-landing-inner">
        <h1 className="region-landing-title">どこを旅しますか？</h1>
        <p className="region-landing-lead">
          まず旅する地域を選ぶと、その範囲の道の駅だけを地図に表示します。あとからいつでも変更できます。
        </p>

        <div className="region-card-grid" data-testid="region-card-grid">
          {areas.map((a) => (
            <button
              key={a.area}
              className="region-card"
              onClick={() => onSelectArea(a.area)}
              data-testid={`region-card-${a.area}`}
            >
              <span className="region-card-name">{a.area}</span>
              <span className="region-card-count">{a.total}駅</span>
            </button>
          ))}
        </div>

        <button
          className="region-landing-pref-toggle"
          onClick={() => setPrefOpen(!prefOpen)}
          aria-expanded={prefOpen}
          data-testid="region-landing-prefecture-toggle"
        >
          {prefOpen ? '▲ 都道府県から選ぶをとじる' : '▼ 都道府県から選ぶ（複数選択できます）'}
        </button>
        {prefOpen && (
          <div className="region-landing-pref" data-testid="region-landing-prefecture">
            <PrefectureChipGroups
              areas={areas}
              statByPref={statByPref}
              selectedPrefectures={selectedPrefectures}
              onToggle={onTogglePrefecture}
              testIdPrefix="region-pref-"
              containerTestId="region-prefecture-groups"
            />
            <button
              className="btn-primary region-landing-confirm"
              disabled={selectedPrefectures.length === 0}
              onClick={onConfirmPrefectures}
              data-testid="region-landing-prefecture-confirm"
            >
              {selectedPrefectures.length === 0
                ? '都道府県を選んでください'
                : `この${selectedPrefectures.length}県で地図を見る`}
            </button>
          </div>
        )}

        <button
          className="region-landing-nationwide"
          onClick={onSelectNationwide}
          data-testid="region-landing-nationwide"
        >
          全国を見る（{totalStations}駅）
        </button>

        {onCancel && (
          <button className="region-landing-cancel" onClick={onCancel} data-testid="region-landing-cancel">
            変更せずに地図へ戻る
          </button>
        )}
      </div>
    </div>
  );
}
