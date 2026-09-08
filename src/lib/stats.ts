import type { AreaName, Prefecture, Station, VisitMap } from '../types';
import { AREA_BY_PREFECTURE, AREAS, PREFECTURES } from '../types';

export interface PrefStat {
  pref: Prefecture;
  total: number;
  visited: number;
  stamped: number;
  want: number;
}

export interface AreaStat {
  area: AreaName;
  total: number;
  visited: number;
  stamped: number;
  want: number;
}

export interface Stats {
  total: number;
  /** 達成数 = visited + stamped */
  visited: number;
  stamped: number;
  want: number;
  /** 0-100 の整数 */
  percent: number;
  byPref: PrefStat[];
  byArea: AreaStat[];
}

/** 達成状況を集計する（分母は常にデータから計算） */
export function computeStats(stations: Station[], visits: VisitMap): Stats {
  const byPref = new Map<Prefecture, PrefStat>(
    PREFECTURES.map((p) => [p, { pref: p, total: 0, visited: 0, stamped: 0, want: 0 }]),
  );
  const byArea = new Map<AreaName, AreaStat>(
    AREAS.map((a) => [a, { area: a, total: 0, visited: 0, stamped: 0, want: 0 }]),
  );
  let visited = 0;
  let stamped = 0;
  let want = 0;
  for (const st of stations) {
    const ps = byPref.get(st.pref);
    const as = byArea.get(AREA_BY_PREFECTURE[st.pref]);
    if (!ps) continue;
    ps.total++;
    if (as) as.total++;
    const state = visits[st.id]?.state;
    if (state === 'visited' || state === 'stamped') {
      visited++;
      ps.visited++;
      if (as) as.visited++;
    }
    if (state === 'stamped') {
      stamped++;
      ps.stamped++;
      if (as) as.stamped++;
    }
    if (state === 'wishlist') {
      want++;
      ps.want++;
      if (as) as.want++;
    }
  }
  const total = stations.length;
  return {
    total,
    visited,
    stamped,
    want,
    percent: total === 0 ? 0 : Math.round((visited / total) * 100),
    byArea: AREAS.map((a) => byArea.get(a)!),
    byPref: PREFECTURES.map((p) => byPref.get(p)!),
  };
}
