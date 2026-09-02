import type { Prefecture, Station, VisitMap } from '../types';
import { PREFECTURES } from '../types';

export interface PrefStat {
  pref: Prefecture;
  total: number;
  visited: number;
  stamped: number;
  want: number;
}

export interface Stats {
  total: number;
  visited: number;
  stamped: number;
  want: number;
  /** 0-100 の整数 */
  percent: number;
  byPref: PrefStat[];
}

/** 達成状況を集計する（分母は常にデータから計算） */
export function computeStats(stations: Station[], visits: VisitMap): Stats {
  const byPref = new Map<Prefecture, PrefStat>(
    PREFECTURES.map((p) => [p, { pref: p, total: 0, visited: 0, stamped: 0, want: 0 }]),
  );
  let visited = 0;
  let stamped = 0;
  let want = 0;
  for (const st of stations) {
    const ps = byPref.get(st.pref);
    if (!ps) continue;
    ps.total++;
    const rec = visits[st.id];
    if (rec?.status === 'visited') {
      visited++;
      ps.visited++;
    }
    if (rec?.status === 'want') {
      want++;
      ps.want++;
    }
    if (rec?.stamp) {
      stamped++;
      ps.stamped++;
    }
  }
  const total = stations.length;
  return {
    total,
    visited,
    stamped,
    want,
    percent: total === 0 ? 0 : Math.round((visited / total) * 100),
    byPref: PREFECTURES.map((p) => byPref.get(p)!),
  };
}
