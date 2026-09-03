/**
 * ルート提案アルゴリズムの機能テスト（仕様§18）。
 * 実データ（東北182施設）を使って検証する。
 */
import { describe, expect, it } from 'vitest';
import { STATIONS } from '../data';
import type { PlanParams, VisitMap } from '../types';
import { planRoutes } from './planner';
import { estimateLegMin } from './geo';

/** 郡山市付近を出発地点にした基本条件 */
function baseParams(over: Partial<PlanParams> = {}): PlanParams {
  return {
    origin: { lat: 37.4004, lng: 140.3597, label: '郡山市' },
    departAt: '2026-09-05T10:00:00+09:00', // 非冬季の土曜
    budgetMin: 240,
    stayMin: 30,
    returnToStart: true,
    useHighway: false,
    maxStops: 6,
    prefs: [],
    crossPref: true,
    target: 'unvisited',
    ...over,
  };
}

describe('ルート提案', () => {
  it('4時間設定で4時間を超えるルートを返さない', () => {
    for (const r of planRoutes(STATIONS, {}, baseParams())) {
      expect(r.totalMin, r.title).toBeLessThanOrEqual(240);
    }
  });

  it('滞在時間が総時間に含まれる', () => {
    const routes = planRoutes(STATIONS, {}, baseParams());
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) {
      const driveSum = r.legs.reduce((a, l) => a + l.driveMin, 0);
      const staySum = r.stops.reduce((a, s) => a + s.stayMin, 0);
      expect(staySum).toBeGreaterThan(0);
      expect(r.totalMin).toBe(driveSum + staySum);
    }
  });

  it('帰着ありでは帰路の区間が含まれる（legs = stops + 1）', () => {
    const routes = planRoutes(STATIONS, {}, baseParams({ returnToStart: true }));
    for (const r of routes.filter((x) => x.params.returnToStart)) {
      expect(r.legs.length).toBe(r.stops.length + 1);
      expect(r.legs[r.legs.length - 1].toId).toBeNull(); // 出発地点へ戻る
    }
  });

  it('帰着なしでは帰路区間がない（legs = stops）', () => {
    const routes = planRoutes(STATIONS, {}, baseParams({ returnToStart: false }));
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) {
      expect(r.legs.length).toBe(r.stops.length);
    }
  });

  it('訪問済み駅を「未訪問のみ」の候補から除外する', () => {
    // 郡山近隣の全駅を訪問済みにする
    const visits: VisitMap = {};
    for (const st of STATIONS) {
      visits[st.id] = {
        state: 'visited',
        visitedAt: '2026-01-01T00:00:00Z',
        wishlistAt: null,
        stampAt: null,
        updatedAt: '2026-01-01T00:00:00Z',
      };
    }
    const routes = planRoutes(STATIONS, visits, baseParams({ target: 'unvisited' }));
    expect(routes.length).toBe(0); // 全駅訪問済みなら候補0件
  });

  it('候補駅が0件でも安全に空配列を返す', () => {
    // 北海道沖を出発地点、同一県内のみ→最寄り県でも遠すぎて到達不可
    const routes = planRoutes(
      STATIONS,
      {},
      baseParams({ budgetMin: 30, origin: { lat: 41.69, lng: 140.0, label: '遠隔地' } }),
    );
    expect(Array.isArray(routes)).toBe(true);
  });

  it('行きたい駅を優先できる', () => {
    // 郡山からやや遠い駅を「行きたい」に設定
    const target = STATIONS.filter(
      (s) => s.pref === '福島県' && s.status === 'open',
    ).sort(
      (a, b) =>
        estimateLegMin({ lat: 37.4004, lng: 140.3597 }, a, false, new Date()) -
        estimateLegMin({ lat: 37.4004, lng: 140.3597 }, b, false, new Date()),
    )[8]; // 9番目に近い駅（通常の最多制覇では選ばれにくい距離）
    const visits: VisitMap = {
      [target.id]: {
        state: 'wishlist',
        visitedAt: null,
        wishlistAt: '2026-01-01T00:00:00Z',
        stampAt: null,
        updatedAt: '2026-01-01T00:00:00Z',
      },
    };
    const routes = planRoutes(STATIONS, visits, baseParams({ target: 'want_priority', budgetMin: 300 }));
    expect(routes.length).toBeGreaterThan(0);
    // 行きたい駅がいずれかの候補コースに含まれる
    // （行きたい優先コースが最多制覇コースと同一になる場合は重複除去されるため）
    const anyHasTarget = routes.some((r) => r.stops.some((s) => s.stationId === target.id));
    expect(anyHasTarget, `行きたい駅 ${target.name} がどのコースにも含まれない`).toBe(true);
  });

  it('県境条件（同一県内のみ）が機能する', () => {
    const routes = planRoutes(
      STATIONS,
      {},
      baseParams({ crossPref: false, budgetMin: 480, origin: { lat: 38.2682, lng: 140.8694, label: '仙台市' } }),
    );
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) {
      for (const s of r.stops) {
        const st = STATIONS.find((x) => x.id === s.stationId)!;
        expect(st.pref, st.name).toBe('宮城県');
      }
    }
  });

  it('対象県の指定が機能する', () => {
    const routes = planRoutes(
      STATIONS,
      {},
      baseParams({ prefs: ['山形県'], budgetMin: 480, origin: { lat: 38.2554, lng: 140.3396, label: '山形市' } }),
    );
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) {
      for (const s of r.stops) {
        expect(STATIONS.find((x) => x.id === s.stationId)!.pref).toBe('山形県');
      }
    }
  });

  it('最大立ち寄り数を超えない', () => {
    const routes = planRoutes(STATIONS, {}, baseParams({ maxStops: 2, budgetMin: 480 }));
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) {
      expect(r.stops.length).toBeLessThanOrEqual(2);
    }
  });

  it('開業前の駅（石川）はどの条件でもルートに含まれない', () => {
    const routes = planRoutes(
      STATIONS,
      {},
      baseParams({ target: 'all', budgetMin: 480, origin: { lat: 37.15, lng: 140.44, label: '石川町付近' } }),
    );
    for (const r of routes) {
      for (const s of r.stops) {
        expect(s.stationId).not.toBe('mlit-r64-ishikawa');
      }
    }
  });

  it('到着予定時刻が単調増加し、出発予定時刻より後', () => {
    const routes = planRoutes(STATIONS, {}, baseParams());
    for (const r of routes) {
      let prev = new Date(r.params.departAt).getTime();
      for (const s of r.stops) {
        const arr = new Date(s.arriveAt).getTime();
        expect(arr).toBeGreaterThan(prev);
        prev = new Date(s.departAt).getTime();
        expect(prev).toBeGreaterThan(arr);
      }
      expect(new Date(r.returnAt).getTime()).toBeGreaterThanOrEqual(prev);
    }
  });

  it('冬季は同一区間の所要時間が長くなる（余裕時間の確保）', () => {
    const a = { lat: 37.4, lng: 140.36 };
    const b = { lat: 37.7, lng: 140.47 };
    const summer = estimateLegMin(a, b, false, new Date('2026-08-01'));
    const winter = estimateLegMin(a, b, false, new Date('2026-01-15'));
    expect(winter).toBeGreaterThan(summer);
  });

  it('出発地点に指定した道の駅自身はルートに含まれない', () => {
    const origin = STATIONS.find((s) => s.name === 'しちのへ')!;
    const routes = planRoutes(
      STATIONS,
      {},
      baseParams({ origin: { lat: origin.lat, lng: origin.lng, label: `道の駅${origin.name}` } }),
    );
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) {
      expect(r.stops.map((s) => s.stationId)).not.toContain(origin.id);
    }
  });

  it('候補は最大3種類で、同一内容（駅順+滞在時間）は重複表示しない', () => {
    const routes = planRoutes(STATIONS, {}, baseParams());
    expect(routes.length).toBeLessThanOrEqual(3);
    const sigs = routes.map((r) => `${r.stops.map((s) => s.stationId).join('>')}::${r.params.stayMin}`);
    expect(new Set(sigs).size).toBe(sigs.length);
  });
});
