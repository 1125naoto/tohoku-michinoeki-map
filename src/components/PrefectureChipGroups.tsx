import type { AreaStat, PrefStat } from '../lib/stats';
import type { SelectedPrefectures } from '../lib/ui';
import { prefecturesInArea } from '../lib/ui';
import type { Prefecture } from '../types';

interface Props {
  /** 表示する地方（既存の集計順＝types.tsのAREASの並び） */
  areas: AreaStat[];
  /** 都道府県名 → 達成状況の索引 */
  statByPref: Map<Prefecture, PrefStat>;
  selectedPrefectures: SelectedPrefectures;
  onToggle: (p: Prefecture) => void;
  /**
   * 各県ボタンの data-testid 接頭辞。既存の絞り込みパネルは 'chip-'（既存テストが参照）、
   * 地域選択画面は 'region-pref-' を使い、同じ画面内でtestidが衝突しないようにする。
   */
  testIdPrefix: string;
  /** コンテナの data-testid */
  containerTestId: string;
}

/**
 * 47都道府県の選択UI（地方ごとの見出し＋折り返しグリッド）。
 *
 * 都道府県は47件あり、横スクロール1行へ並べると実機で「地方チップしか実質使えない」
 * 状態になるため、地方ごとに折り返して全県を個別にタップできるようにしている。
 * 絞り込みパネルと地域選択画面の両方がこの1つの実装を使い、県一覧・地方区分を
 * 二重管理しない（地方区分は types.ts の AREA_BY_PREFECTURE が唯一の定義）。
 */
export default function PrefectureChipGroups({
  areas,
  statByPref,
  selectedPrefectures,
  onToggle,
  testIdPrefix,
  containerTestId,
}: Props) {
  return (
    <div className="pref-select-groups" data-testid={containerTestId}>
      {areas.map((a) => (
        <div className="pref-select-group" key={a.area}>
          <div className="pref-select-group-title">{a.area}</div>
          <div className="pref-select-group-chips">
            {prefecturesInArea(a.area).map((pref) => {
              const p = statByPref.get(pref);
              if (!p) return null;
              return (
                <button
                  key={p.pref}
                  className={`chip${selectedPrefectures.includes(p.pref) ? ' active' : ''}`}
                  onClick={() => onToggle(p.pref)}
                  data-testid={`${testIdPrefix}${p.pref}`}
                >
                  {p.pref.replace('県', '')} {p.visited}/{p.total}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
