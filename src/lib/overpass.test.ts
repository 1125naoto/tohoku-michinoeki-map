import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTO_ESCALATE_MAX_M,
  DEFAULT_RADIUS_M,
  MIN_AUTO_RESULTS,
  POI_RESULT_LIMIT,
  __setStaggerMsForTest,
  clearPoiCache,
  peekCachedPois,
  searchNearbyPois,
  searchNearbyPoisAuto,
} from './overpass';
import { POI_SCHEMA_VERSION } from './poi';

const LAT = 37.4004;
const LNG = 140.3597;

function makeElements(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    type: 'node',
    id: 1000 + i,
    lat: LAT + i * 0.0005,
    lon: LNG + i * 0.0005,
    tags: { amenity: 'cafe', name: `カフェ${i}` },
  }));
}

/**
 * PART: 現在地検索は food(restaurant/cafe/fast_food/bar/pub)と other(それ以外)を
 * 別クエリで並行実行するため(overpass.ts参照)、1回の検索につきfetchは基本2回呼ばれる。
 * エンドポイント故障シミュレーションは「呼び出し順」ではなく「URLごとの累積呼び出し回数」で
 * 判定する（food/otherの2レースが並行するため、呼び出し順に依存したモックは
 * どちらのレースの何本目かが原理的に確定できず壊れやすいため）。
 */
function urlKeyedMock(
  behavior: (url: string, callIndexForUrl: number) => { ok: boolean; status?: number; elements?: unknown[] } | 'reject-network' | 'reject-timeout',
) {
  const countByUrl = new Map<string, number>();
  return vi.fn().mockImplementation((url: string) => {
    const n = (countByUrl.get(url) ?? 0) + 1;
    countByUrl.set(url, n);
    const result = behavior(url, n);
    if (result === 'reject-network') return Promise.reject(new Error('network down'));
    if (result === 'reject-timeout') return Promise.reject(new DOMException('Aborted', 'AbortError'));
    return Promise.resolve({ ok: result.ok, status: result.status, json: async () => ({ elements: result.elements ?? [] }) });
  });
}

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemoryStorage();
  clearPoiCache();
  // stagger raceの実タイマー待ちでテストが遅くならないよう既定では短くする。
  // 0msにはしない: 0だとforEachの同期実行中にendpoint0の勝敗が決まる前に
  // 全endpointのfetch()が呼ばれてしまう。数msでもマクロタスク(setTimeout)は
  // モックfetchのマイクロタスク解決より必ず後に実行されるため、
  // 「先に成功したら後続は呼ばれない」という本番と同じ挙動を維持できる。
  __setStaggerMsForTest(5);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('検索結果の取得', () => {
  it('成功時はPOIを距離順で返す', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ elements: makeElements(3) }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(res.failed).toBe(false);
    expect(res.pois.length).toBe(3);
    // food/otherの2クエリを並行実行するため、双方とも1本目のエンドポイントで成功すると2回になる
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (let i = 1; i < res.pois.length; i++) {
      expect(res.pois[i].distanceM).toBeGreaterThanOrEqual(res.pois[i - 1].distanceM);
    }
  });

  it('POI_RESULT_LIMITを超える件数でもここでは絞られない（絞り込みは呼び出し側でカテゴリ選択後に行う）', async () => {
    // 「食べる全体を上限件数だけ取得→クライアント側でラーメン等に絞る」という構造が、
    // 都市部で実在するラーメン店等を取りこぼす原因だったため、overpass.ts側の
    // 全カテゴリ横断での事前スライスは廃止した（App.tsx側で「すべて」表示時のみ絞る）。
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ elements: makeElements(POI_RESULT_LIMIT + 20) }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(res.pois.length).toBe(POI_RESULT_LIMIT + 20);
  });

  it('分類できない要素は結果から除外される', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        elements: [
          { type: 'node', id: 1, lat: LAT, lon: LNG, tags: { shop: 'supermarket' } }, // 分類不能
          { type: 'node', id: 2, lat: LAT, lon: LNG, tags: { amenity: 'cafe', name: 'OK' } },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(res.pois.length).toBe(1);
    expect(res.pois[0].name).toBe('OK');
  });
});

describe('キャッシュ', () => {
  it('同じ条件の再検索はキャッシュから返し、fetchを呼び直さない', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elements: makeElements(2) }) });
    vi.stubGlobal('fetch', fetchMock);
    await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(fetchMock).toHaveBeenCalledTimes(2); // 1回目の検索でfood+otherの2回のみ
  });

  it('30分経過するとキャッシュを使わず再取得する', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elements: makeElements(1) }) });
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
    try {
      await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
      vi.advanceTimersByTime(31 * 60 * 1000);
      await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
      expect(fetchMock).toHaveBeenCalledTimes(4); // 検索2回 × (food+other)
    } finally {
      vi.useRealTimers();
    }
  });

  it('検索半径が違えば別キャッシュ扱いになる', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elements: makeElements(1) }) });
    vi.stubGlobal('fetch', fetchMock);
    await searchNearbyPois(LAT, LNG, 1000);
    await searchNearbyPois(LAT, LNG, 5000);
    expect(fetchMock).toHaveBeenCalledTimes(4); // 検索2回 × (food+other)
  });
});

describe('障害時のふるまい', () => {
  it('通信エラー時は例外を投げず failed:true を返す（アプリを落とさない）', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(res.failed).toBe(true);
    expect(res.pois).toEqual([]);
  });

  it('接続先が1回目だけ失敗しても、同じ接続先の2回目以降(=別レースからの呼び出し)や次の接続先で成功できる', async () => {
    const fetchMock = urlKeyedMock((url, n) => {
      if (url.includes('private.coffee') && n === 1) return 'reject-timeout';
      return { ok: true, elements: makeElements(1) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(res.failed).toBe(false);
    expect(res.pois.length).toBeGreaterThan(0);
  });

  it('全接続先が失敗した場合はfailed:trueで打ち切る（無限リトライしない）', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('down'));
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    // food/otherそれぞれが3接続先を試行して打ち切る(無制限ではない)
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(res.failed).toBe(true);
  });

  it('HTTPエラーステータスもfailed扱いになる', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 504, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(res.failed).toBe(true);
  });

  it('1つ目の接続先が429の場合、2つ目の接続先へ切り替えて成功できる', async () => {
    const fetchMock = urlKeyedMock((url) => {
      if (url.includes('private.coffee')) return { ok: false, status: 429 };
      return { ok: true, elements: makeElements(1) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(res.failed).toBe(false);
    expect(res.pois.length).toBe(1);
  });

  it('1つ目の接続先が504の場合、2つ目の接続先へ切り替えて成功できる', async () => {
    const fetchMock = urlKeyedMock((url) => {
      if (url.includes('private.coffee')) return { ok: false, status: 504 };
      return { ok: true, elements: makeElements(1) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(res.failed).toBe(false);
  });

  it('1つ目の接続先がタイムアウト（通信エラー）の場合、2つ目の接続先へ切り替えて成功できる', async () => {
    const fetchMock = urlKeyedMock((url) => {
      if (url.includes('private.coffee')) return 'reject-timeout';
      return { ok: true, elements: makeElements(1) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(res.failed).toBe(false);
  });

  it('全接続先が失敗した場合はfailed:trueになる（同一接続先への無制限リトライはしない）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    // food/otherそれぞれが3接続先を試行して打ち切る(無制限ではない)
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(res.failed).toBe(true);
    expect(res.pois).toEqual([]);
  });

  it('0件（検索は成功したが該当なし）と通信失敗は区別される', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elements: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(res.failed).toBe(false);
    expect(res.pois).toEqual([]);
  });

  it('接続先の優先順は private.coffee → maps.mail.ru(VK Maps) → overpass-api.de（旧kumi.systemsは含まれない）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    // food/otherの2クエリぶん、同じ順序が2セット並ぶ
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    const expectedOrder = [
      'https://overpass.private.coffee/api/interpreter',
      'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
      'https://overpass-api.de/api/interpreter',
    ];
    expect(urls).toHaveLength(6);
    expect(new Set(urls)).toEqual(new Set(expectedOrder));
    expect(urls.some((u) => u.includes('kumi.systems'))).toBe(false);
  });

  it('1本目がstagger間隔より先に成功すれば、2本目・3本目は一度も呼ばれない', async () => {
    __setStaggerMsForTest(20);
    try {
      let calls = 0;
      const fetchMock = vi.fn().mockImplementation(() => {
        calls++;
        // 1本目はstagger間隔(20ms)より短い1msで成功させる
        return new Promise((resolve) =>
          setTimeout(() => resolve({ ok: true, json: async () => ({ elements: makeElements(1) }) }), 1),
        );
      });
      vi.stubGlobal('fetch', fetchMock);
      const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
      expect(res.failed).toBe(false);
      // food/otherそれぞれ1本目だけで決着するため2回
      expect(calls).toBe(2);
      // 2本目・3本目はstagger待ち中にabortされ、一度もfetchが呼ばれない
      await new Promise((r) => setTimeout(r, 50));
      expect(calls).toBe(2);
    } finally {
      __setStaggerMsForTest(5);
    }
  });

  it('1本目が遅ければ、staggerで開始した2本目が先に成功できる', async () => {
    __setStaggerMsForTest(20);
    try {
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes('private.coffee')) {
          // 1本目はstagger間隔より遅い(100ms)
          return new Promise((resolve) =>
            setTimeout(() => resolve({ ok: true, json: async () => ({ elements: makeElements(1) }) }), 100),
          );
        }
        // 2本目(maps.mail.ru)はすぐ成功する
        return Promise.resolve({ ok: true, json: async () => ({ elements: makeElements(9) }) });
      });
      vi.stubGlobal('fetch', fetchMock);
      const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
      expect(res.failed).toBe(false);
      // food/other双方が2本目(maps.mail.ru)の結果(9件)を採用するが、
      // food/otherは同じ内容の要素を返す単純なモックのため、名前+座標が一致しdedupeされ9件になる
      expect(res.pois.length).toBe(9);
    } finally {
      __setStaggerMsForTest(5);
    }
  });

  it('呼び出し側のsignalで中断した場合は例外を投げる（結果を上書きしない）', async () => {
    const fetchMock = vi.fn().mockImplementation(
      (_url: string, opts: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          const s = opts?.signal;
          if (s?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
          }
          s?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const ctrl = new AbortController();
    const promise = searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M, ctrl.signal);
    ctrl.abort();
    await expect(promise).rejects.toBeTruthy();
  });
});

describe('前回成功結果の劣化フォールバック（全接続先失敗時）', () => {
  it('過去に成功していれば、全接続先失敗時でも前回の結果をfromCache:trueで返す', async () => {
    const okMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elements: makeElements(2) }) });
    vi.stubGlobal('fetch', okMock);
    const first = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(first.fromCache).toBe(false);

    // 30分キャッシュを飛び越して「新鮮なキャッシュではない」状態を作る
    vi.useFakeTimers();
    try {
      await vi.advanceTimersByTimeAsync(31 * 60 * 1000);
      const failMock = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
      vi.stubGlobal('fetch', failMock);
      const secondPromise = searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
      // stagger raceの遅延タイマー(setTimeout)はフェイクタイマー配下では自動進行しないため、
      // Promiseの解決と交互にタイマーを進める advanceTimersByTimeAsync で明示的に進める
      await vi.advanceTimersByTimeAsync(100);
      const second = await secondPromise;
      expect(second.failed).toBe(false);
      expect(second.fromCache).toBe(true);
      expect(second.pois.length).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('過去に一度も成功していなければ、全接続先失敗時は素直にfailed:trueになる', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(res.failed).toBe(true);
    expect(res.fromCache).toBe(false);
  });

  it('30分以内の新鮮なキャッシュはfromCache:trueで返る', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elements: makeElements(1) }) });
    vi.stubGlobal('fetch', fetchMock);
    await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    const second = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(second.fromCache).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2); // 1回目の検索でfood+otherの2回のみ
  });

  describe('実機で報告された不具合の回帰: 旧ビルドが保存した結果を新ビルドで再利用しない', () => {
    // 旧ビルド（subcategoriesが無い/旧分類）が端末に保存した前回結果が、新ビルドでも
    // 静的キャッシュより優先されて表示され続け、「ラーメン0件」になっていた。
    const key = `${LAT.toFixed(4)},${LNG.toFixed(4)}:${DEFAULT_RADIUS_M}`;
    const oldPoi = {
      id: 'osm:node/1',
      category: 'food',
      subcategory: 'food_other', // 旧分類: 実際はラーメン店だが cuisine が無く food_other に落ちていた
      name: 'ラーメン太郎',
      lat: LAT,
      lng: LNG,
      address: null,
      openingHoursRaw: null,
      phone: null,
      website: null,
      distanceM: 10,
      source: 'overpass',
      sourceUrl: 'https://www.openstreetmap.org/node/1',
    };

    it('旧キー(v1)に保存された結果は読まずに削除する', () => {
      localStorage.setItem('tohoku-me:poi-last-ok:v1', JSON.stringify({ [key]: { at: Date.now(), pois: [oldPoi] } }));
      expect(peekCachedPois(LAT, LNG, DEFAULT_RADIUS_M)).toBeNull();
      expect(localStorage.getItem('tohoku-me:poi-last-ok:v1')).toBeNull();
    });

    it('版(v)が現在と異なるストアは読まずに削除する', () => {
      localStorage.setItem(
        'tohoku-me:poi-last-ok:v2',
        JSON.stringify({ v: '1:oldPoiData', entries: { [key]: { at: Date.now(), pois: [oldPoi] } } }),
      );
      expect(peekCachedPois(LAT, LNG, DEFAULT_RADIUS_M)).toBeNull();
      expect(localStorage.getItem('tohoku-me:poi-last-ok:v2')).toBeNull();
    });

    it('現在の版で保存した結果は再利用でき、保存形式は{v, entries}になっている', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elements: makeElements(2) }) });
      vi.stubGlobal('fetch', fetchMock);
      await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
      const raw = JSON.parse(localStorage.getItem('tohoku-me:poi-last-ok:v2')!) as { v: string; entries: Record<string, unknown> };
      expect(typeof raw.v).toBe('string');
      expect(raw.v).toMatch(new RegExp(`^${POI_SCHEMA_VERSION}:`)); // POI_SCHEMA_VERSION + 静的POIデータ版
      expect(Object.keys(raw.entries)).toContain(key);
      expect(peekCachedPois(LAT, LNG, DEFAULT_RADIUS_M)?.length).toBe(2);
    });
  });
});

describe('peekCachedPois（stale-while-revalidate用の同期プレビュー）', () => {
  it('過去に成功結果が無ければnull（何も無いのに表示を捏造しない）', () => {
    expect(peekCachedPois(LAT, LNG, DEFAULT_RADIUS_M)).toBeNull();
  });

  it('新鮮なメモリキャッシュがあればそれを返す（通信しない）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elements: makeElements(2) }) });
    vi.stubGlobal('fetch', fetchMock);
    await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    const peeked = peekCachedPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(peeked?.length).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2); // peek自体は通信しない（検索1回=food+otherの2回のみ）
  });

  it('メモリキャッシュが切れていても、端末保存の前回成功結果があれば返す', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elements: makeElements(3) }) });
    vi.stubGlobal('fetch', fetchMock);
    await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    vi.useFakeTimers();
    try {
      await vi.advanceTimersByTimeAsync(31 * 60 * 1000); // 30分キャッシュは切れるが、端末保存(7日)はまだ有効
      const peeked = peekCachedPois(LAT, LNG, DEFAULT_RADIUS_M);
      expect(peeked?.length).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('診断ログ（attemptLog）', () => {
  it('成功時は成功した接続先のログ(outcome:ok, status, elementCount)を含む', async () => {
    const fetchMock = urlKeyedMock((url) => {
      if (url.includes('private.coffee')) return { ok: false, status: 429 };
      return { ok: true, status: 200, elements: makeElements(2) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    // food/otherそれぞれについて「1本目429失敗→2本目成功」のログが1組ずつ、計4件
    expect(res.attemptLog).toHaveLength(4);
    const httpErrors = res.attemptLog.filter((a) => a.outcome === 'http_error');
    const oks = res.attemptLog.filter((a) => a.outcome === 'ok');
    expect(httpErrors).toHaveLength(2);
    expect(httpErrors.every((a) => a.status === 429)).toBe(true);
    expect(oks).toHaveLength(2);
    expect(oks.every((a) => a.status === 200 && a.elementCount === 2)).toBe(true);
  });

  it('タイムアウトはoutcome:timeoutとして記録される', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(res.attemptLog.every((a) => a.outcome === 'timeout')).toBe(true);
  });

  it('キャッシュヒット時はattemptLogが空配列になる（新規通信していないため）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elements: makeElements(1) }) });
    vi.stubGlobal('fetch', fetchMock);
    await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    const second = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(second.fromCache).toBe(true);
    expect(second.attemptLog).toEqual([]);
  });

  it('searchNearbyPoisAutoは範囲拡張をまたいでattemptLogを累積する', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ elements: makeElements(1) }) }) // 3km food: 少ない
      .mockResolvedValueOnce({ ok: true, json: async () => ({ elements: makeElements(1) }) }) // 3km other: 少ない
      .mockResolvedValue({ ok: true, json: async () => ({ elements: makeElements(5) }) }); // 5km以降: 十分
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPoisAuto(LAT, LNG, 3000);
    // 3km(food+other) → 5km(food+other) の計4件
    expect(res.attemptLog).toHaveLength(4);
    expect(res.attemptLog[0].radiusM).toBe(3000);
    expect(res.attemptLog[1].radiusM).toBe(3000);
    expect(res.attemptLog[2].radiusM).toBe(5000);
    expect(res.attemptLog[3].radiusM).toBe(5000);
  });
});

describe('検索範囲の自動拡張（searchNearbyPoisAuto）', () => {
  it('最初の範囲で十分な件数があれば範囲を広げない', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ elements: makeElements(MIN_AUTO_RESULTS) }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPoisAuto(LAT, LNG, DEFAULT_RADIUS_M);
    expect(res.radiusUsed).toBe(DEFAULT_RADIUS_M);
    expect(res.pois.length).toBe(MIN_AUTO_RESULTS);
    expect(fetchMock).toHaveBeenCalledTimes(2); // food+other
  });

  it('結果が少ない場合は次の検索範囲まで自動的に広げる', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ elements: makeElements(1) }) }) // 3km food: 少ない
      .mockResolvedValueOnce({ ok: true, json: async () => ({ elements: [] }) }) // 3km other
      .mockResolvedValue({ ok: true, json: async () => ({ elements: makeElements(5) }) }); // 5km以降: 十分
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPoisAuto(LAT, LNG, 3000);
    expect(res.failed).toBe(false);
    expect(res.radiusUsed).toBe(5000);
    expect(fetchMock).toHaveBeenCalledTimes(4); // (food+other)×2段階
  });

  it('AUTO_ESCALATE_MAX_Mまで広げても少ない場合はそこで打ち切る（失敗扱いにはしない）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elements: makeElements(1) }) });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPoisAuto(LAT, LNG, 3000);
    expect(res.failed).toBe(false);
    expect(res.radiusUsed).toBe(AUTO_ESCALATE_MAX_M);
    // 3km → 5km → 10km の3段階 ×(food+other) で打ち切り（15kmへは自動では進まない）
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('通信が失敗した場合は範囲を広げずに失敗を返す（無意味な再試行をしない）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPoisAuto(LAT, LNG, 3000);
    expect(res.failed).toBe(true);
    expect(res.radiusUsed).toBe(3000);
    // 1段階分の3接続先フェイルオーバー ×(food+other) のみ（範囲を変えて再試行しない）
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('ユーザーが最初からAUTO_ESCALATE_MAX_Mを超える範囲(15km)を選んでいた場合は広げない', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elements: makeElements(1) }) });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPoisAuto(LAT, LNG, 15000);
    expect(res.radiusUsed).toBe(15000);
    expect(fetchMock).toHaveBeenCalledTimes(2); // food+other
  });
});

describe('food/otherクエリの分離（都市部でラーメン等が80件上限に埋もれる不具合の修正）', () => {
  it('foodクエリはrestaurant/cafe/fast_food/bar/pubのみを対象にする', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elements: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    const bodies = fetchMock.mock.calls.map((c) => decodeURIComponent((c[1] as { body: string }).body));
    const foodBody = bodies.find((b) => b.includes('restaurant|cafe|fast_food|bar|pub'));
    expect(foodBody).toBeDefined();
    // foodクエリにtourism/onsen等は含まれない
    expect(foodBody).not.toContain('tourism');
    expect(foodBody).not.toContain('hot_spring');
  });

  it('otherクエリはfood以外(観光・温泉・宿泊等)のみを対象にする', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elements: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    const bodies = fetchMock.mock.calls.map((c) => decodeURIComponent((c[1] as { body: string }).body));
    const otherBody = bodies.find((b) => b.includes('tourism'));
    expect(otherBody).toBeDefined();
    expect(otherBody).not.toContain('restaurant');
  });

  it('foodが80件を超える都市部相当でも、food分は取りこぼさず返す（実データ監査で確認した不具合の回帰）', async () => {
    // 実機/実データ監査: 都市部3km圏内でfoodだけで80件超が実在し、旧実装(food+other共有80件上限)では
    // 大半が観光施設等に押し出されラーメン等が0件になっていた。food専用クエリで100件相当を返せることを確認する。
    const fetchMock = vi.fn().mockImplementation((_url: string, opts: { body: string }) => {
      const body = decodeURIComponent(opts.body);
      if (body.includes('restaurant|cafe|fast_food|bar|pub')) {
        return Promise.resolve({ ok: true, json: async () => ({ elements: makeElements(90) }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ elements: [] }) });
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(res.failed).toBe(false);
    expect(res.pois.length).toBe(90); // 旧実装なら80件で打ち切られていた
  });

  it('foodだけ全滅してもotherが成功していれば部分的な結果を返す（failed:trueにしない）', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, opts: { body: string }) => {
      const body = decodeURIComponent(opts.body);
      if (body.includes('restaurant|cafe|fast_food|bar|pub')) {
        return Promise.reject(new Error('food query down'));
      }
      return Promise.resolve({ ok: true, json: async () => ({ elements: makeElements(2) }) });
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(res.failed).toBe(false);
    expect(res.pois.length).toBe(2);
  });

  it('food/other両方が全滅した場合のみfailed:trueになる', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('down'));
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(res.failed).toBe(true);
  });

  it('回帰: 都市部で飲食店85件+観光施設20件が実在する場合、旧実装(全カテゴリ共有80件上限)なら' +
    'ラーメン店が結果から漏れていたが、新実装(food専用クエリ)では確実に含まれる', async () => {
    // 実データ監査(仙台駅3km圏)を模した状況: 飲食店だけで80件を超えて実在し、
    // ラーメン店は距離順で85番目(=旧実装の80件カットラインの外)にある。
    const foodElements = Array.from({ length: 85 }, (_, i) =>
      i === 84
        ? { type: 'node', id: 9000, lat: LAT + 0.001, lon: LNG + 0.001, tags: { amenity: 'restaurant', cuisine: 'ramen', name: 'ご当地ラーメン店' } }
        : { type: 'node', id: 2000 + i, lat: LAT, lon: LNG, tags: { amenity: 'restaurant', name: `一般食堂${i}` } },
    );
    const otherElements = Array.from({ length: 20 }, (_, i) => ({
      type: 'node',
      id: 3000 + i,
      lat: LAT,
      lon: LNG,
      tags: { tourism: 'attraction', name: `観光地${i}` },
    }));
    const fetchMock = vi.fn().mockImplementation((_url: string, opts: { body: string }) => {
      const body = decodeURIComponent(opts.body);
      if (body.includes('restaurant|cafe|fast_food|bar|pub')) {
        return Promise.resolve({ ok: true, json: async () => ({ elements: foodElements }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ elements: otherElements }) });
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(res.failed).toBe(false);
    // 旧実装なら (food+other計105件を距離順に80件へ切る、かつfoodは観光施設と1本のクエリを
    // 共有していたため) ラーメン店が結果に入らないことがあった。新実装ではfood全85件を
    // 独立取得するため、必ず含まれる。
    const ramenPoi = res.pois.find((p) => p.name === 'ご当地ラーメン店');
    expect(ramenPoi).toBeDefined();
    expect(ramenPoi?.subcategory).toBe('ramen');
  });

  it('foodIncomplete/otherIncompleteが完全成功では両方false、food全滅では foodIncomplete:true のみになる', async () => {
    const okFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elements: [] }) });
    vi.stubGlobal('fetch', okFetch);
    const ok = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(ok.foodIncomplete).toBe(false);
    expect(ok.otherIncomplete).toBe(false);

    clearPoiCache();
    const partialFetch = vi.fn().mockImplementation((_url: string, opts: { body: string }) => {
      const body = decodeURIComponent(opts.body);
      if (body.includes('restaurant|cafe|fast_food|bar|pub')) return Promise.reject(new Error('food down'));
      return Promise.resolve({ ok: true, json: async () => ({ elements: makeElements(2) }) });
    });
    vi.stubGlobal('fetch', partialFetch);
    const partial = await searchNearbyPois(LAT + 1, LNG + 1, DEFAULT_RADIUS_M);
    expect(partial.failed).toBe(false);
    expect(partial.foodIncomplete).toBe(true);
    expect(partial.otherIncomplete).toBe(false);
  });

  it('キャッシュヒット時もfoodIncomplete/otherIncompleteが保存時の値を保持して返る', async () => {
    const partialFetch = vi.fn().mockImplementation((_url: string, opts: { body: string }) => {
      const body = decodeURIComponent(opts.body);
      if (body.includes('restaurant|cafe|fast_food|bar|pub')) return Promise.reject(new Error('food down'));
      return Promise.resolve({ ok: true, json: async () => ({ elements: makeElements(2) }) });
    });
    vi.stubGlobal('fetch', partialFetch);
    const first = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(first.foodIncomplete).toBe(true);
    const cached = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(cached.fromCache).toBe(true);
    expect(cached.foodIncomplete).toBe(true);
    expect(cached.otherIncomplete).toBe(false);
  });

  it('部分成功の結果は、既存の完全な劣化フォールバック(前回成功結果)を上書きしない', async () => {
    // メモリキャッシュ(TTL 30分)だけを経過させ、劣化フォールバック(TTL 7日)は
    // 有効なまま保つため、実時間を進める代わりにDate.nowを進める。
    const realNow = Date.now();
    const dateSpy = vi.spyOn(Date, 'now');

    // 1回目: food/otherとも完全成功 → 劣化フォールバックに完全な結果が保存される
    dateSpy.mockReturnValue(realNow);
    const foodEls = makeElements(3);
    // dedupePoisは名前+座標でも重複判定するため、id・名前・座標のいずれもfood側と衝突させない
    const otherEls = makeElements(2).map((el) => ({
      ...el,
      id: el.id + 5000,
      lat: el.lat + 1,
      lon: el.lon + 1,
      tags: { ...el.tags, name: `温泉${el.id}` },
    }));
    const fullFetch = vi.fn().mockImplementation((_url: string, opts: { body: string }) => {
      const body = decodeURIComponent(opts.body);
      if (body.includes('restaurant|cafe|fast_food|bar|pub')) {
        return Promise.resolve({ ok: true, json: async () => ({ elements: foodEls }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ elements: otherEls }) });
    });
    vi.stubGlobal('fetch', fullFetch);
    const first = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(first.pois.length).toBe(5);

    // 2回目: メモリキャッシュを期限切れにする(31分後)。foodだけ全滅させる。
    dateSpy.mockReturnValue(realNow + 31 * 60 * 1000);
    const partialFetch = vi.fn().mockImplementation((_url: string, opts: { body: string }) => {
      const body = decodeURIComponent(opts.body);
      if (body.includes('restaurant|cafe|fast_food|bar|pub')) return Promise.reject(new Error('food down'));
      return Promise.resolve({ ok: true, json: async () => ({ elements: makeElements(2) }) });
    });
    vi.stubGlobal('fetch', partialFetch);
    const partial = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(partial.fromCache).toBe(false);
    expect(partial.foodIncomplete).toBe(true);
    expect(partial.pois.length).toBe(2); // 今回表示される分は部分結果のまま

    // 3回目: さらにメモリキャッシュを期限切れにし(62分後)、food/otherとも全滅させる。
    // 劣化フォールバックを読むが、それは1回目の完全な5件のはず
    // (2回目の部分結果2件では上書きされていない)
    dateSpy.mockReturnValue(realNow + 62 * 60 * 1000);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    const fallback = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(fallback.failed).toBe(false);
    expect(fallback.fromCache).toBe(true);
    expect(fallback.pois.length).toBe(5);
  });
});

describe('応答の妥当性検証（HTTP 200だがremark/elements欠如などの不正応答を失敗扱いにする）', () => {
  it('HTTP 200でもremarkフィールドがあれば成功とみなさず、全滅時はfailed:trueになる', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ remark: 'runtime error: Query timed out.' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(res.failed).toBe(true);
    expect(res.foodIncomplete).toBe(true);
    expect(res.otherIncomplete).toBe(true);
    expect(res.pois).toEqual([]);
  });

  it('HTTP 200でelements配列が無い応答も不正応答として扱い、成功の0件と混同しない', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(res.failed).toBe(true);
    expect(res.attemptLog.every((a) => a.outcome === 'malformed')).toBe(true);
  });

  it('foodだけremark応答、otherは正常な0件なら、部分成功として扱われfailed:falseになる', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, opts: { body: string }) => {
      const body = decodeURIComponent(opts.body);
      if (body.includes('restaurant|cafe|fast_food|bar|pub')) {
        return Promise.resolve({ ok: true, json: async () => ({ remark: 'runtime error' }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ elements: [] }) });
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(res.failed).toBe(false);
    expect(res.foodIncomplete).toBe(true);
    expect(res.otherIncomplete).toBe(false);
    expect(res.pois).toEqual([]); // otherは正常応答で「本当に0件」
  });

  it('正常なelements:0件の応答はmalformed扱いにならない（本当に周辺に無い場合と区別できる）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elements: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(res.failed).toBe(false);
    expect(res.foodIncomplete).toBe(false);
    expect(res.otherIncomplete).toBe(false);
    expect(res.attemptLog.every((a) => a.outcome === 'ok')).toBe(true);
  });
});
