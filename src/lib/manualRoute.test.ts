/**
 * 「地図から選ぶ」ルート作成のロジックテスト（実データ182施設）。
 * ネットワークへ出ないよう、planner.test.ts と同様に注入Providerで決定的に検証する。
 */
import { describe, expect, it } from 'vitest';
import { STATIONS } from '../data';
import type { RoutingProvider } from './routing';
import {
  MAX_MANUAL_STATIONS,
  MIN_MANUAL_STATIONS,
  buildManualMatrix,
  buildManualRoute,
  evaluateManual,
  fitToBudget,
  orderManual,
  type ManualPlanParams,
} from './manualRoute';
import { estimateLegMin, haversineKm } from './geo';
import { normalizeOsmElement, type Poi } from './poi';

const failProvider: RoutingProvider = {
  name: 'fail',
  table: () => Promise.reject(new Error('service down')),
  route: () => Promise.reject(new Error('service down')),
};

function makeFakeRoadProvider() {
  const calls: number[] = [];
  const provider: RoutingProvider = {
    name: 'fake-road',
    async table(points) {
      calls.push(points.length);
      const n = points.length;
      const durationsMin: number[][] = [];
      const distancesKm: number[][] = [];
      for (let i = 0; i < n; i++) {
        durationsMin.push([]);
        distancesKm.push([]);
        for (let j = 0; j < n; j++) {
          durationsMin[i].push(i === j ? 0 : estimateLegMin(points[i], points[j], true, new Date('2026-09-05')));
          distancesKm[i].push(i === j ? 0 : haversineKm(points[i], points[j]) * 1.3);
        }
      }
      return { durationsMin, distancesKm };
    },
    route: () => Promise.reject(new Error('not needed')),
  };
  return { provider, calls };
}

const ORIGIN = { lat: 37.4004, lng: 140.3597, label: '郡山市' };

function baseParams(over: Partial<ManualPlanParams> = {}): ManualPlanParams {
  return {
    origin: ORIGIN,
    departAt: '2026-09-05T10:00:00+09:00',
    stayMin: 30,
    returnToStart: true,
    roadPref: 'highway_ok',
    budgetMin: 480,
    orderMode: 'selected',
    ...over,
  };
}

// 郡山市から近い順の開業済み駅を使い、決定的な選択集合を作る
const nearIds = STATIONS.filter((s) => s.status === 'open')
  .sort((a, b) => haversineKm(ORIGIN, a) - haversineKm(ORIGIN, b))
  .slice(0, 6)
  .map((s) => s.id);

describe('定数', () => {
  it('最低2駅・最大20駅', () => {
    expect(MIN_MANUAL_STATIONS).toBe(2);
    expect(MAX_MANUAL_STATIONS).toBe(20);
  });
});

describe('選択駅だけを対象にする', () => {
  it('選択した駅だけがルートに含まれ、未選択駅は含まれない', async () => {
    const selected = nearIds.slice(0, 3);
    const { matrix, candidates } = await buildManualMatrix(STATIONS, {}, selected, baseParams(), {
      provider: failProvider,
    });
    const order = orderManual(candidates, matrix, baseParams({ orderMode: 'selected' }));
    const route = buildManualRoute(order, matrix, baseParams({ orderMode: 'selected' }), 'approx', '地図から選んだコース', 'テスト');
    expect(route).not.toBeNull();
    const ids = route!.stops.map((s) => s.stationId);
    expect(ids.sort()).toEqual([...selected].sort());
    expect(ids.length).toBe(3);
  });

  it('選択駅が勝手に削除・追加されない（budgetMin=nullでも全駅を含む）', async () => {
    const selected = nearIds.slice(0, 4);
    const { matrix, candidates } = await buildManualMatrix(STATIONS, {}, selected, baseParams(), {
      provider: failProvider,
    });
    const order = orderManual(candidates, matrix, baseParams({ orderMode: 'selected' }));
    const route = buildManualRoute(
      order,
      matrix,
      baseParams({ orderMode: 'selected', budgetMin: null }),
      'approx',
      't',
      'r',
    );
    expect(route!.stops.length).toBe(4);
  });
});

describe('順序: 選んだ順 vs 自動調整', () => {
  it('selectedモードは選択順をそのまま維持する', async () => {
    const selected = nearIds; // 6駅
    const { matrix, candidates } = await buildManualMatrix(STATIONS, {}, selected, baseParams(), {
      provider: failProvider,
    });
    const order = orderManual(candidates, matrix, baseParams({ orderMode: 'selected' }));
    expect(order.map((c) => c.st.id)).toEqual(selected);
  });

  it('optimizedモードは同じ駅集合を保ったまま並べ替える（移動時間が選択順以下になる）', async () => {
    // 意図的にジグザグな順で選択（近い順ではなく郡山からの距離降順=遠い順）
    const zigzag = [...nearIds].reverse();
    const { matrix, candidates } = await buildManualMatrix(STATIONS, {}, zigzag, baseParams(), {
      provider: failProvider,
    });
    const selectedOrder = orderManual(candidates, matrix, baseParams({ orderMode: 'selected' }));
    const optimizedOrder = orderManual(candidates, matrix, baseParams({ orderMode: 'optimized' }));
    expect(optimizedOrder.map((c) => c.st.id).sort()).toEqual(selectedOrder.map((c) => c.st.id).sort());
    const selEv = evaluateManual(selectedOrder, matrix, baseParams());
    const optEv = evaluateManual(optimizedOrder, matrix, baseParams());
    expect(optEv!.driveMin).toBeLessThanOrEqual(selEv!.driveMin);
  });

  it('未選択駅は自動調整後も含まれない', async () => {
    const selected = nearIds.slice(0, 5);
    const { matrix, candidates } = await buildManualMatrix(STATIONS, {}, selected, baseParams(), {
      provider: failProvider,
    });
    const optimizedOrder = orderManual(candidates, matrix, baseParams({ orderMode: 'optimized' }));
    expect(optimizedOrder.map((c) => c.st.id).sort()).toEqual([...selected].sort());
  });
});

describe('帰着ON/OFF', () => {
  it('帰着ONではlegsがstops+1、OFFではstopsと同数', async () => {
    const selected = nearIds.slice(0, 3);
    const { matrix, candidates } = await buildManualMatrix(STATIONS, {}, selected, baseParams(), {
      provider: failProvider,
    });
    const orderOn = orderManual(candidates, matrix, baseParams({ returnToStart: true }));
    const routeOn = buildManualRoute(orderOn, matrix, baseParams({ returnToStart: true }), 'approx', 't', 'r');
    expect(routeOn!.legs.length).toBe(routeOn!.stops.length + 1);
    expect(routeOn!.legs[routeOn!.legs.length - 1].toId).toBeNull();

    const orderOff = orderManual(candidates, matrix, baseParams({ returnToStart: false }));
    const routeOff = buildManualRoute(orderOff, matrix, baseParams({ returnToStart: false }), 'approx', 't', 'r');
    expect(routeOff!.legs.length).toBe(routeOff!.stops.length);
  });
});

describe('時間超過の扱い', () => {
  it('選択駅すべてを回ると予算を超える場合、除外候補を提示できる（除外は貪欲法で時間短縮が大きい駅から）', async () => {
    const selected = nearIds; // 6駅
    const { matrix, candidates } = await buildManualMatrix(STATIONS, {}, selected, baseParams(), {
      provider: failProvider,
    });
    const order = orderManual(candidates, matrix, baseParams({ orderMode: 'optimized' }));
    const fullEv = evaluateManual(order, matrix, baseParams())!;
    const tightBudget = Math.round(fullEv.totalMin * 0.5); // 明らかに収まらない予算
    const { kept, excluded } = fitToBudget(order, matrix, baseParams(), tightBudget);
    expect(excluded.length).toBeGreaterThan(0);
    expect(kept.length + excluded.length).toBe(order.length);
    // 除外された駅名を提示できる（st.nameを持つ）
    for (const c of excluded) expect((c.st.name ?? '').length).toBeGreaterThan(0);
    const keptEv = evaluateManual(kept, matrix, baseParams());
    if (kept.length > 0) expect(keptEv!.totalMin).toBeLessThanOrEqual(tightBudget);
  });

  it('回帰: 1件だけなら収まる予算でも、全滞在込みの予算超過分から一律に安全余裕を引いてはならない（本来1件は残るべき）', async () => {
    // 元の全件（大幅超過）の安全余裕を固定で差し引くと、絞り込むほど余裕不足になり全除外され得る。
    // fitToBudgetは候補を減らすたびに安全余裕を再計算しなければならない。
    const selected = nearIds; // 6駅
    const { matrix, candidates } = await buildManualMatrix(STATIONS, {}, selected, baseParams(), {
      provider: failProvider,
    });
    const order = orderManual(candidates, matrix, baseParams({ orderMode: 'optimized' }));
    // 最も近い1駅だけを残す場合に必要な予算（滞在込み・安全余裕込み）を求める
    const singletons = order.map((c) => [c]);
    const singleEvs = singletons.map((s) => evaluateManual(s, matrix, baseParams())!);
    const minSingleWithMargin = Math.min(...singleEvs.map((ev) => ev.totalMin + Math.max(10, Math.round(ev.totalMin * 0.1))));
    // 最も安い1駅なら余裕を持って収まるが、全件を回るには全く足りない予算にする
    // （貪欲法は必ずしも最安の1駅へ収束するとは限らないため、境界値ぴったりにはしない）
    const budgetMin = minSingleWithMargin + 20;
    const { kept } = fitToBudget(order, matrix, baseParams(), budgetMin);
    expect(kept.length).toBeGreaterThanOrEqual(1);
    // 実際にコースを作成できる（buildManualRouteがnullを返さない）ことも確認する
    const built = buildManualRoute(kept, matrix, baseParams({ budgetMin }), 'approx', 't', 'r');
    expect(built).not.toBeNull();
  });

  it('予算内に収まる場合は何も除外しない', async () => {
    const selected = nearIds.slice(0, 2);
    const { matrix, candidates } = await buildManualMatrix(STATIONS, {}, selected, baseParams(), {
      provider: failProvider,
    });
    const order = orderManual(candidates, matrix, baseParams());
    const { kept, excluded } = fitToBudget(order, matrix, baseParams(), 480);
    expect(excluded.length).toBe(0);
    expect(kept.length).toBe(order.length);
  });
});

describe('営業時間との連携', () => {
  it('到着予定時刻ベースの営業見込み集計を持つ（自動除外はしない＝全選択駅が含まれる）', async () => {
    const night = '2026-09-04T22:00:00+09:00'; // ほぼ全駅が営業時間外
    const selected = nearIds.slice(0, 3);
    const { matrix, candidates } = await buildManualMatrix(
      STATIONS,
      {},
      selected,
      baseParams({ departAt: night }),
      { provider: failProvider },
    );
    const order = orderManual(candidates, matrix, baseParams({ departAt: night }));
    const route = buildManualRoute(order, matrix, baseParams({ departAt: night }), 'approx', 't', 'r');
    expect(route!.stops.length).toBe(selected.length); // 時間外でも除外されない
    const s = route!.hoursSummary;
    expect(s.open + s.closing + s.closed + s.unknown).toBe(route!.stops.length);
    expect(s.closed).toBeGreaterThan(0);
  });
});

describe('実道路時間と概算フォールバック', () => {
  it('Provider成功時は roadData=road、行列リクエストは1回', async () => {
    const { provider, calls } = makeFakeRoadProvider();
    const selected = nearIds.slice(0, 4);
    const { matrix, roadData, candidates } = await buildManualMatrix(STATIONS, {}, selected, baseParams(), {
      provider,
    });
    expect(roadData).toBe('road');
    expect(calls.length).toBe(1);
    expect(calls[0]).toBe(selected.length + 1); // 出発地点+選択駅
    const order = orderManual(candidates, matrix, baseParams());
    const route = buildManualRoute(order, matrix, baseParams(), roadData, 't', 'r');
    expect(route!.roadData).toBe('road');
  });

  it('Provider障害時は概算へフォールバックし落ちない', async () => {
    const selected = nearIds.slice(0, 3);
    const { matrix, roadData, candidates } = await buildManualMatrix(STATIONS, {}, selected, baseParams(), {
      provider: failProvider,
    });
    expect(roadData).toBe('approx');
    const order = orderManual(candidates, matrix, baseParams());
    const route = buildManualRoute(order, matrix, baseParams(), roadData, 't', 'r');
    expect(route!.roadData).toBe('approx');
    expect(route!.stops.length).toBe(selected.length);
  });
});

// 郡山市近郊のダミーPOI（実際のOverpass応答形式を模した正規化データ）
const RAMEN_POI: Poi = normalizeOsmElement(
  { type: 'node', id: 90001, lat: 37.41, lon: 140.37, tags: { amenity: 'restaurant', cuisine: 'ramen', name: 'テストラーメン' } },
  ORIGIN,
)!;
const ONSEN_POI: Poi = normalizeOsmElement(
  { type: 'node', id: 90002, lat: 37.42, lon: 140.38, tags: { natural: 'hot_spring', name: 'テスト温泉' } },
  ORIGIN,
)!;

describe('道の駅＋周辺スポットの混合ルート', () => {
  it('道の駅とPOIを同じ座標地点として扱い、両方がルートに含まれる', async () => {
    const stationIds = nearIds.slice(0, 2);
    const pois: Record<string, Poi> = { [RAMEN_POI.id]: RAMEN_POI, [ONSEN_POI.id]: ONSEN_POI };
    const selected = [stationIds[0], RAMEN_POI.id, stationIds[1], ONSEN_POI.id];
    const { matrix, candidates } = await buildManualMatrix(STATIONS, pois, selected, baseParams(), {
      provider: failProvider,
    });
    expect(candidates.length).toBe(4);
    const order = orderManual(candidates, matrix, baseParams({ orderMode: 'selected' }));
    const route = buildManualRoute(order, matrix, baseParams({ orderMode: 'selected' }), 'approx', 't', 'r');
    expect(route!.stops.length).toBe(4);
    expect(route!.stops.map((s) => s.stationId)).toEqual(selected);
    expect(route!.stops[0].stopType).toBe('station');
    expect(route!.stops[1].stopType).toBe('restaurant');
    expect(route!.stops[1].poi?.name).toBe('テストラーメン');
    expect(route!.stops[3].stopType).toBe('onsen');
  });

  it('地点ごとの滞在時間が反映される（駅30分・ラーメン45分・温泉90分の既定値）', async () => {
    const stationIds = nearIds.slice(0, 1);
    const pois: Record<string, Poi> = { [RAMEN_POI.id]: RAMEN_POI, [ONSEN_POI.id]: ONSEN_POI };
    const selected = [stationIds[0], RAMEN_POI.id, ONSEN_POI.id];
    const { matrix, candidates } = await buildManualMatrix(STATIONS, pois, selected, baseParams({ stayMin: 30 }), {
      provider: failProvider,
    });
    const order = orderManual(candidates, matrix, baseParams({ orderMode: 'selected' }));
    const route = buildManualRoute(order, matrix, baseParams({ orderMode: 'selected' }), 'approx', 't', 'r');
    expect(route!.stops[0].stayMin).toBe(30); // 道の駅の既定
    expect(route!.stops[1].stayMin).toBe(45); // ラーメンの既定
    expect(route!.stops[2].stayMin).toBe(90); // 温泉の既定
    expect(route!.stayTotalMin).toBe(30 + 45 + 90);
  });

  it('stayOverridesで個別に滞在時間を上書きできる', async () => {
    const pois: Record<string, Poi> = { [RAMEN_POI.id]: RAMEN_POI };
    const selected = [nearIds[0], RAMEN_POI.id];
    const params = baseParams({ orderMode: 'selected', stayOverrides: { [RAMEN_POI.id]: 120 } });
    const { matrix, candidates } = await buildManualMatrix(STATIONS, pois, selected, params, {
      provider: failProvider,
    });
    const order = orderManual(candidates, matrix, params);
    const route = buildManualRoute(order, matrix, params, 'approx', 't', 'r');
    expect(route!.stops[1].stayMin).toBe(120);
  });

  it('道の駅だけがnewCountに反映され、POIは達成率に影響しない', async () => {
    const pois: Record<string, Poi> = { [RAMEN_POI.id]: RAMEN_POI, [ONSEN_POI.id]: ONSEN_POI };
    const selected = [nearIds[0], nearIds[1], RAMEN_POI.id, ONSEN_POI.id];
    const { matrix, candidates } = await buildManualMatrix(STATIONS, pois, selected, baseParams(), {
      provider: failProvider,
    });
    const order = orderManual(candidates, matrix, baseParams({ orderMode: 'selected' }));
    const route = buildManualRoute(order, matrix, baseParams({ orderMode: 'selected' }), 'approx', 't', 'r');
    expect(route!.newCount).toBe(2); // 道の駅2件のみ
  });

  it('POIは営業時間見込み集計(hoursSummary)の対象外', async () => {
    const pois: Record<string, Poi> = { [RAMEN_POI.id]: RAMEN_POI };
    const selected = [nearIds[0], RAMEN_POI.id];
    const { matrix, candidates } = await buildManualMatrix(STATIONS, pois, selected, baseParams(), {
      provider: failProvider,
    });
    const order = orderManual(candidates, matrix, baseParams({ orderMode: 'selected' }));
    const route = buildManualRoute(order, matrix, baseParams({ orderMode: 'selected' }), 'approx', 't', 'r');
    const s = route!.hoursSummary;
    expect(s.open + s.closing + s.closed + s.unknown).toBe(1); // 道の駅1件のみ集計
  });
});
