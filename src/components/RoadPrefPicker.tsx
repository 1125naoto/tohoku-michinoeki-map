import type { RoadPref } from '../types';

/** 道路の希望の表示ラベル（「高速優先」のような誤解を招く名称は使わない） */
export const ROAD_PREF_LABELS: Record<RoadPref, string> = {
  highway_ok: 'おまかせ・早いルート',
  no_tolls: '有料道路を使わない',
  no_highway: '一般道を優先',
};

interface Props {
  value: RoadPref;
  onChange: (v: RoadPref) => void;
  /** trueのとき見出しを省略（旅行中画面など、狭い場所に埋め込む用） */
  compact?: boolean;
}

/**
 * 道路の希望（おまかせ・早いルート／有料道路を使わない／一般道を優先）。
 * おすすめコース・地図から選ぶ・旅行中のすべてで共通して使う部品。
 * OSRM公開デモは有料道路回避・一般道優先を厳密に計算できないため、
 * この設定はGoogleマップのURL（avoidパラメータ）にのみ反映され、
 * アプリ内の予想時間計算には反映されないことを明記する。
 */
export default function RoadPrefPicker({ value, onChange, compact }: Props) {
  return (
    <div>
      {!compact && <label>道路の希望</label>}
      <div className="seg" style={{ marginTop: compact ? 0 : 4 }}>
        <button
          className={value === 'highway_ok' ? 'active' : ''}
          onClick={() => onChange('highway_ok')}
          data-testid="roadpref-fast"
        >
          おまかせ・早いルート
        </button>
        <button
          className={value === 'no_tolls' ? 'active' : ''}
          onClick={() => onChange('no_tolls')}
          data-testid="roadpref-no-tolls"
        >
          有料道路を使わない
        </button>
        <button
          className={value === 'no_highway' ? 'active' : ''}
          onClick={() => onChange('no_highway')}
          data-testid="roadpref-no-highway"
        >
          一般道を優先
        </button>
      </div>
      {value !== 'highway_ok' && (
        <p className="msg info" style={{ marginBottom: 0, marginTop: 6 }} data-testid="roadpref-note">
          この希望はGoogleマップでナビ・経路確認を開くときに反映されます（コース作成の予想時間には反映されません）。
        </p>
      )}
      {value === 'no_highway' && (
        <p className="msg warn" style={{ marginBottom: 0, marginTop: 6 }} data-testid="roadpref-general-warn">
          予想時間は通常の道路条件による目安です。Googleマップで一般道優先にすると、実際の時間が長くなる場合があります。
        </p>
      )}
    </div>
  );
}
