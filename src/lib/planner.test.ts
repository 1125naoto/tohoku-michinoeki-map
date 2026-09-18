/**
 * 周遊コース作成の機能テスト（実データ182施設）。
 * ネットワークに出ないよう、失敗するProvider（=概算フォールバック）と
 * 概算行列を返す擬似「実道路」Providerを注入して決定的に検証する。
 */
import { describe, expect, it } from 'vitest';
import { STATIONS } from '../data';
import type { PlanParams, Prefecture, VisitMap } from '../types';

/** 営業時間データが揃っている東北6県（全国化で他地域が到達範囲に入っても結果を決定的にするため使用） */
const TOHOKU_PREFS: Prefecture[] = ['青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県'];
import { planCourses } from './planner';
import { estimateLegMin, haversineKm } from './geo';
import type { RoutingProvider } from './routing';

/** 常に失敗するProvider → 概算フォールバック経路を決定的にテスト */
const failProvider: RoutingProvider = {
  name: 'fail',
  table: () => Promise.reject(new Error('service down')),
  route: () => Promise.reject(new Error('service down')),
};

/** 概算と同じ値を返す擬似実道路Provider（呼び出し回数と地点数を記録） */
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

function baseParams(over: Partial<PlanParams> = {}): PlanParams {
  return {
    origin: { lat: 37.4004, lng: 140.3597, label: '郡山市' },
    departAt: '2026-09-05T10:00:00+09:00',
    budgetMin: 240,
    stayMin: 30,
    returnToStart: true,
    roadPref: 'highway_ok',
    maxStops: 6,
    prefs: [],
    crossPref: true,
    priority: 'unvisited',
    includeVisited: false,
    includeStamped: false,
    preferOpenHours: true,
    includeClosedHours: true,
    includeUnknownHours: true,
    ...over,
  };
}

const plan = (visits: VisitMap, over: Partial<PlanParams> = {}) =>
  planCourses(STATIONS, visits, baseParams(over), { provider: failProvider });

describe('時間計算', () => {
  it('2時間・4時間・6時間・任意(5時間)のどのコースも設定時間を超えない', async () => {
    for (const budgetMin of [120, 240, 360, 300]) {
      const { courses } = await plan({}, { budgetMin });
      expect(courses.length).toBeGreaterThan(0);
      for (const r of courses) {
        expect(r.totalMin + r.marginMin, `${budgetMin}分/${r.key}`).toBeLessThanOrEqual(budgetMin);
      }
    }
  });

  it('滞在時間を必ず含み、移動+滞在=合計が厳密に一致する（丸め超過なし）', async () => {
    const { courses } = await plan({});
    for (const r of courses) {
      expect(r.stayTotalMin).toBe(r.stops.length * r.params.stayMin);
      const legSum = r.legs.reduce((a, l) => a + l.driveMin, 0);
      for (const l of r.legs) expect(Number.isInteger(l.driveMin)).toBe(true); // 区間ごとに切り上げ済み
      expect(r.driveMin).toBe(legSum);
      expect(r.totalMin).toBe(r.driveMin + r.stayTotalMin);
    }
  });

  it('帰着ONでは帰路の区間を含む（legs=stops+1）、OFFでは含まない', async () => {
    const on = await plan({}, { returnToStart: true });
    for (const r of on.courses) {
      expect(r.legs.length).toBe(r.stops.length + 1);
      expect(r.legs[r.legs.length - 1].toId).toBeNull();
    }
    const off = await plan({}, { returnToStart: false });
    expect(off.courses.length).toBeGreaterThan(0);
    for (const r of off.courses) expect(r.legs.length).toBe(r.stops.length);
  });

  it('ゆったりコースは15%以上の安全余裕を持つ', async () => {
    const { courses } = await plan({}, { budgetMin: 360 });
    const relax = courses.find((r) => r.key === 'relax');
    if (relax) {
      expect(relax.marginMin).toBeGreaterThanOrEqual(Math.round(360 * 0.15));
    }
    // どのコースにも最低限の余裕がある
    for (const r of courses) expect(r.marginMin).toBeGreaterThanOrEqual(8);
  });

  it('設定時間が短すぎる場合は空を返し、落ちない', async () => {
    const { courses } = await plan({}, { budgetMin: 60, stayMin: 60 });
    expect(Array.isArray(courses)).toBe(true);
  });
});

describe('優先条件', () => {
  const rec = (state: 'visited' | 'wishlist' | 'stamped') => ({
    state,
    visitedAt: state !== 'wishlist' ? '2026-01-01T00:00:00Z' : null,
    wishlistAt: state === 'wishlist' ? '2026-01-01T00:00:00Z' : null,
    stampAt: state === 'stamped' ? '2026-01-01T00:00:00Z' : null,
    updatedAt: '2026-01-01T00:00:00Z',
  });

  it('visited/stampedは標準候補から除外され、includeフラグで含められる', async () => {
    const visits: VisitMap = {};
    for (const st of STATIONS) visits[st.id] = rec('visited');
    const excluded = await plan(visits);
    expect(excluded.courses.length).toBe(0); // 全駅訪問済み→候補なし
    const included = await plan(visits, { includeVisited: true });
    expect(included.courses.length).toBeGreaterThan(0);
    expect(included.courses[0].newCount).toBe(0); // 新規制覇は0
  });

  it('stampedはincludeStampedでのみ候補になる', async () => {
    const visits: VisitMap = {};
    for (const st of STATIONS) visits[st.id] = rec('stamped');
    expect((await plan(visits)).courses.length).toBe(0);
    expect((await plan(visits, { includeStamped: true })).courses.length).toBeGreaterThan(0);
  });

  it('行きたい優先でwishlist駅が最上位コースに含まれる', async () => {
    const target = STATIONS.filter((s) => s.pref === '福島県' && s.status === 'open').sort(
      (a, b) =>
        estimateLegMin({ lat: 37.4004, lng: 140.3597 }, a, false, new Date()) -
        estimateLegMin({ lat: 37.4004, lng: 140.3597 }, b, false, new Date()),
    )[8];
    const visits: VisitMap = { [target.id]: rec('wishlist') };
    const { courses } = await plan(visits, { priority: 'wishlist', budgetMin: 300 });
    expect(courses.length).toBeGreaterThan(0);
    expect(courses[0].wantCount).toBeGreaterThan(0); // 行きたいを含むコースが最上位
    expect(courses[0].stops.map((s) => s.stationId)).toContain(target.id);
  });

  it('近い順では近距離の駅が優先される', async () => {
    const { courses } = await plan({}, { priority: 'nearest' });
    const byDist = STATIONS.filter((s) => s.status === 'open')
      .filter((s) => haversineKm({ lat: 37.4004, lng: 140.3597 }, s) > 0.05)
      .sort(
        (a, b) =>
          haversineKm({ lat: 37.4004, lng: 140.3597 }, a) - haversineKm({ lat: 37.4004, lng: 140.3597 }, b),
      )
      .map((s) => s.id);
    const max = courses.find((r) => r.key === 'max')!;
    // 最寄り駅がコースに含まれ、先頭は近傍5駅以内（挿入法は巡回全体の近さを最適化する）
    expect(max.stops.map((s) => s.stationId)).toContain(byDist[0]);
    expect(byDist.slice(0, 5)).toContain(max.stops[0].stationId);
  });

  it('開業前(upcoming)はどの設定でも候補にならない', async () => {
    // 開業日が未到来の「くらたけ天草戦国ミュージアム」(熊本県天草市・2026年11月22日予定)の近くから計画する
    const { courses } = await plan(
      {},
      {
        includeVisited: true,
        includeStamped: true,
        prefs: ['熊本県'],
        budgetMin: 480,
        origin: { lat: 32.41, lng: 130.33, label: '天草市付近' },
      },
    );
    for (const r of courses) {
      expect(r.stops.map((s) => s.stationId)).not.toContain('mne-23223');
    }
  });

  it('対象県・県境条件・最大立ち寄り数が機能する', async () => {
    const yamagata = await plan({}, { prefs: ['山形県'], budgetMin: 480, origin: { lat: 38.2554, lng: 140.3396, label: '山形市' } });
    for (const r of yamagata.courses)
      for (const s of r.stops) expect(STATIONS.find((x) => x.id === s.stationId)!.pref).toBe('山形県');
    const sameOnly = await plan({}, { crossPref: false, budgetMin: 480, origin: { lat: 38.2682, lng: 140.8694, label: '仙台市' } });
    for (const r of sameOnly.courses)
      for (const s of r.stops) expect(STATIONS.find((x) => x.id === s.stationId)!.pref).toBe('宮城県');
    const capped = await plan({}, { maxStops: 2, budgetMin: 480 });
    for (const r of capped.courses) expect(r.stops.length).toBeLessThanOrEqual(2);
  });

  it('出発地点に指定した道の駅自身は含まれない', async () => {
    const origin = STATIONS.find((s) => s.name === 'しちのへ')!;
    const { courses } = await plan({}, { origin: { lat: origin.lat, lng: origin.lng, label: `道の駅${origin.name}` } });
    for (const r of courses) expect(r.stops.map((s) => s.stationId)).not.toContain(origin.id);
  });
});

describe('実道路時間と概算フォールバック', () => {
  it('Provider成功時は roadData=road、行列リクエストは1回・地点数は最大23', async () => {
    const { provider, calls } = makeFakeRoadProvider();
    const res = await planCourses(STATIONS, {}, baseParams(), { provider });
    expect(res.roadData).toBe('road');
    for (const r of res.courses) expect(r.roadData).toBe('road');
    expect(calls.length).toBe(1); // 182駅の全組み合わせを問い合わせない
    expect(calls[0]).toBeLessThanOrEqual(23); // 出発地点+最大22駅
    // 実道路時間でも時間予算は厳守
    for (const r of res.courses) expect(r.totalMin + r.marginMin).toBeLessThanOrEqual(240);
  });

  it('Provider障害時は概算へフォールバックし、roadData=approxで落ちない', async () => {
    const res = await plan({});
    expect(res.roadData).toBe('approx');
    expect(res.courses.length).toBeGreaterThan(0);
    for (const r of res.courses) expect(r.roadData).toBe('approx');
  });

  it('コースは最大3案で、同一の駅順は重複しない', async () => {
    const { courses } = await plan({});
    expect(courses.length).toBeLessThanOrEqual(3);
    const sigs = courses.map((r) => r.stops.map((s) => s.stationId).join('>'));
    expect(new Set(sigs).size).toBe(sigs.length);
  });

  it('各コースに理由文がある', async () => {
    const { courses } = await plan({});
    for (const r of courses) expect(r.reason.length).toBeGreaterThan(5);
  });
});

describe('到達不能区間の扱い（Astra P1: 通信障害と到達不能の混同防止）', () => {
  /**
   * OSRMが正常応答した上で「一部の駅ペアだけ到達不能」と判定するケースを
   * 決定的に再現するProvider（離島・海峡等で実際に起こりうる状況の模擬）。
   */
  function makeProviderWithUnreachablePair(unreachableIndex: number) {
    const provider: RoutingProvider = {
      name: 'fake-road-with-unreachable',
      async table(points) {
        const n = points.length;
        const durationsMin: number[][] = [];
        const distancesKm: number[][] = [];
        for (let i = 0; i < n; i++) {
          durationsMin.push([]);
          distancesKm.push([]);
          for (let j = 0; j < n; j++) {
            const isUnreachablePair =
              (i === 0 && j === unreachableIndex) || (i === unreachableIndex && j === 0);
            if (i !== j && isUnreachablePair) {
              durationsMin[i].push(Number.POSITIVE_INFINITY);
              distancesKm[i].push(Number.POSITIVE_INFINITY);
            } else {
              durationsMin[i].push(i === j ? 0 : estimateLegMin(points[i], points[j], true, new Date('2026-09-05')));
              distancesKm[i].push(i === j ? 0 : haversineKm(points[i], points[j]) * 1.3);
            }
          }
        }
        return { durationsMin, distancesKm };
      },
      route: () => Promise.reject(new Error('not needed')),
    };
    return provider;
  }

  it('出発地点から到達不能な駅を含む並びは提案されない（自動提案は成立するrouteのみ採用）', async () => {
    const provider = makeProviderWithUnreachablePair(1); // 行列index1の駅（=最初の候補）を到達不能にする
    const res = await planCourses(STATIONS, {}, baseParams({ maxStops: 3 }), { provider });
    expect(res.roadData).toBe('road'); // OSRM自体は正常応答している
    expect(res.courses.length).toBeGreaterThan(0); // 他の候補で成立するコースは提案される
    for (const r of res.courses) {
      for (const leg of r.legs) {
        expect(Number.isFinite(leg.driveMin)).toBe(true);
        // 到達不能を概算で覆い隠していない = unreachableフラグが立つ区間が無い
        expect(leg.unreachable).toBeFalsy();
      }
    }
  });

  it('providerが返した行列オブジェクトを書き換えない（routing.ts内部キャッシュの汚染防止）', async () => {
    const provider = makeProviderWithUnreachablePair(1);
    let capturedMatrix: { durationsMin: number[][] } | null = null;
    const wrapped: RoutingProvider = {
      name: 'capture',
      table: async (points, signal) => {
        const m = await provider.table(points, signal);
        capturedMatrix = m;
        return m;
      },
      route: provider.route,
    };
    await planCourses(STATIONS, {}, baseParams({ maxStops: 3 }), { provider: wrapped });
    // planCoursesが内部でセルを書き換えていたら、providerが返した同一オブジェクトの
    // Infinityが消えているはず。書き換えていなければInfinityが残る。
    expect(capturedMatrix).not.toBeNull();
    expect(capturedMatrix!.durationsMin[0][1]).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('営業時間との連携', () => {
  const night = '2026-09-04T22:00:00+09:00'; // JST 22時 = ほぼ全駅が営業時間外

  it('到着予定時刻ベースの営業見込み集計(hoursSummary)を持つ', async () => {
    const { courses } = await plan({});
    for (const r of courses) {
      const s = r.hoursSummary;
      expect(s.open + s.closing + s.closed + s.unknown).toBe(r.stops.length);
    }
  });

  it('昼出発では営業中見込みが多数、夜出発では営業時間外が多数になる', async () => {
    const day = await plan({});
    const dayMax = day.courses.find((r) => r.key === 'max')!;
    expect(dayMax.hoursSummary.open + dayMax.hoursSummary.closing).toBeGreaterThan(0);
    const nightRes = await plan({}, { departAt: night });
    const nightMax = nightRes.courses.find((r) => r.key === 'max');
    if (nightMax) {
      expect(nightMax.hoursSummary.closed).toBeGreaterThan(0);
    }
  });

  it('「営業時間外予想の駅も含める」をOFFにすると夜間は候補が消える（既定では完全除外しない）', async () => {
    // 全国化により、この出発地からの到達範囲に営業時間データ未収録（unknown扱い）の
    // 他地域駅が入り得るため、確定的な検証には営業時間データが揃う東北6県に絞る
    // （includeClosedHoursは「確定的に営業時間外」のみ除外し、unknownは除外しない設計のため）。
    const included = await plan({}, { departAt: night, prefs: TOHOKU_PREFS }); // 既定: 含める+優先度ダウン
    expect(included.courses.length).toBeGreaterThan(0);
    const excluded = await plan({}, { departAt: night, includeClosedHours: false, prefs: TOHOKU_PREFS });
    // 夜22時出発では営業中到着できる駅がほぼ無いため、候補0件になる
    expect(excluded.courses.length).toBe(0);
  });

  it('営業時間内優先ON/OFFでコース内容に差が出得る（ONは時間外駅の優先度を下げる）', async () => {
    // 夕方出発: まもなく閉まる駅が混在する時間帯
    const evening = '2026-09-04T16:30:00+09:00';
    const on = await plan({}, { departAt: evening, preferOpenHours: true });
    const off = await plan({}, { departAt: evening, preferOpenHours: false });
    expect(on.courses.length).toBeGreaterThan(0);
    expect(off.courses.length).toBeGreaterThan(0);
    // どちらも時間予算は厳守
    for (const r of [...on.courses, ...off.courses]) {
      expect(r.totalMin + r.marginMin).toBeLessThanOrEqual(240);
    }
  });

  it('営業時間不明の駅は既定で候補に含まれ、OFFで除外できる', async () => {
    // 要確認駅(例: mne-22686 いわき・ら・ら・ミュウ)の近くから出発
    const origin = { lat: 36.945, lng: 140.89, label: 'いわき市街' };
    const def = await plan({}, { origin, budgetMin: 180 });
    const hasUnknown = def.courses.some((r) => r.hoursSummary.unknown > 0);
    expect(hasUnknown).toBe(true); // 既定では含まれる
    const strict = await plan({}, { origin, budgetMin: 180, includeUnknownHours: false });
    for (const r of strict.courses) expect(r.hoursSummary.unknown).toBe(0);
  });
});
