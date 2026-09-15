import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ROUTE_DRAFT, ROUTE_DRAFT_KEY, clearRouteDraft, loadRouteDraft, saveRouteDraft } from './routeDraft';
import { normalizeOsmElement, type Poi } from './poi';

const SAMPLE_POI: Poi = normalizeOsmElement(
  { type: 'node', id: 1, lat: 37.4, lon: 140.36, tags: { amenity: 'cafe', name: 'テストカフェ' } },
  { lat: 37.4, lng: 140.36 },
)!;

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
});

describe('下書きの保存・読み込み', () => {
  it('未保存時はnull', () => {
    expect(loadRouteDraft()).toBeNull();
  });
  it('保存→読み込みで内容が維持される', () => {
    const draft = { ...DEFAULT_ROUTE_DRAFT, selectedIds: ['a', 'b'], inProgress: true };
    saveRouteDraft(draft);
    const loaded = loadRouteDraft();
    expect(loaded?.selectedIds).toEqual(['a', 'b']);
    expect(loaded?.inProgress).toBe(true);
  });
  it('壊れたデータはnullを返す（アプリを落とさない）', () => {
    localStorage.setItem(ROUTE_DRAFT_KEY, '{bad json');
    expect(loadRouteDraft()).toBeNull();
    localStorage.setItem(ROUTE_DRAFT_KEY, JSON.stringify({ selectedIds: 'not-an-array' }));
    expect(loadRouteDraft()).toBeNull();
  });
  it('完成・キャンセル時にclearすると消える', () => {
    saveRouteDraft({ ...DEFAULT_ROUTE_DRAFT, selectedIds: ['a'] });
    expect(loadRouteDraft()).not.toBeNull();
    clearRouteDraft();
    expect(loadRouteDraft()).toBeNull();
  });
  it('訪問記録キーとは分離されている', () => {
    saveRouteDraft({ ...DEFAULT_ROUTE_DRAFT, selectedIds: ['a'] });
    expect(localStorage.getItem('tohoku-me:visits:v2')).toBeNull();
  });
});

describe('周辺スポット(POI)の選択・滞在時間上書き', () => {
  it('selectedPois・stayOverridesが保存・復元される', () => {
    const draft = {
      ...DEFAULT_ROUTE_DRAFT,
      selectedIds: ['mne-1', SAMPLE_POI.id],
      selectedPois: { [SAMPLE_POI.id]: SAMPLE_POI },
      stayOverrides: { [SAMPLE_POI.id]: 90 },
    };
    saveRouteDraft(draft);
    const loaded = loadRouteDraft();
    expect(loaded?.selectedPois[SAMPLE_POI.id]?.name).toBe('テストカフェ');
    expect(loaded?.stayOverrides[SAMPLE_POI.id]).toBe(90);
  });

  it('旧v1データ（selectedPois/stayOverridesが無い）も読み込め、空オブジェクトで補完される', () => {
    localStorage.setItem(
      ROUTE_DRAFT_KEY,
      JSON.stringify({
        selectedIds: ['mne-1'],
        origin: null,
        returnToStart: true,
        orderMode: 'optimized',
        budgetMin: 240,
        stayMin: 30,
        roadPref: 'highway_ok',
        inProgress: true,
      }),
    );
    const loaded = loadRouteDraft();
    expect(loaded).not.toBeNull();
    expect(loaded?.selectedIds).toEqual(['mne-1']);
    expect(loaded?.selectedPois).toEqual({});
    expect(loaded?.stayOverrides).toEqual({});
  });

  it('壊れたPOIデータだけを取り除き、他の下書き内容は保護する', () => {
    localStorage.setItem(
      ROUTE_DRAFT_KEY,
      JSON.stringify({
        ...DEFAULT_ROUTE_DRAFT,
        selectedIds: ['mne-1', SAMPLE_POI.id],
        selectedPois: { [SAMPLE_POI.id]: { broken: true }, ok: SAMPLE_POI },
        stayOverrides: { good: 30, bad: 'not-a-number' },
      }),
    );
    const loaded = loadRouteDraft();
    expect(loaded).not.toBeNull();
    expect(loaded?.selectedIds).toEqual(['mne-1', SAMPLE_POI.id]); // 選択IDは保護される
    expect(loaded?.selectedPois[SAMPLE_POI.id]).toBeUndefined(); // 壊れた項目のみ除去
    expect(loaded?.selectedPois.ok?.name).toBe('テストカフェ'); // 正常な項目は残る
    expect(loaded?.stayOverrides.good).toBe(30);
    expect(loaded?.stayOverrides.bad).toBeUndefined();
  });

  it('宿泊(lodging)の周辺スポットを含む下書きが再読み込みで欠落しない（データ消失の回帰）', () => {
    // 'lodging' カテゴリの追加後、下書き復元の検証リストに追加漏れがあり、
    // ホテル等を含む下書きが黙って欠落していた
    const hotel = normalizeOsmElement(
      { type: 'node', id: 2, lat: 37.41, lon: 140.37, tags: { tourism: 'hotel', name: 'テストホテル' } },
      { lat: 37.4, lng: 140.36 },
    )!;
    expect(hotel.category).toBe('lodging');
    saveRouteDraft({
      ...DEFAULT_ROUTE_DRAFT,
      selectedIds: [hotel.id],
      selectedPois: { [hotel.id]: hotel },
      inProgress: true,
    });
    const loaded = loadRouteDraft();
    expect(loaded?.selectedPois[hotel.id]?.name).toBe('テストホテル');
  });
});

describe('自由地点（アプリ未登録の場所）・最終目的地の選択', () => {
  const HOTEL = { name: '○○ホテル', address: '山形県山形市testtown1-2-3', lat: 38.24, lng: 140.34 };

  it('selectedCustomStops・finalDestinationが保存・復元される', () => {
    const draft = {
      ...DEFAULT_ROUTE_DRAFT,
      selectedIds: ['mne-1', 'custom:1-abc'],
      selectedCustomStops: { 'custom:1-abc': HOTEL },
      finalDestination: HOTEL,
    };
    saveRouteDraft(draft);
    const loaded = loadRouteDraft();
    expect(loaded?.selectedCustomStops['custom:1-abc']).toEqual(HOTEL);
    expect(loaded?.finalDestination).toEqual(HOTEL);
  });

  it('旧v2データ（selectedCustomStops/finalDestinationが無い）も読み込め、既定値で補完される（後方互換）', () => {
    localStorage.setItem(
      ROUTE_DRAFT_KEY,
      JSON.stringify({
        selectedIds: ['mne-1', SAMPLE_POI.id],
        origin: null,
        returnToStart: true,
        orderMode: 'optimized',
        budgetMin: 240,
        stayMin: 30,
        roadPref: 'highway_ok',
        selectedPois: { [SAMPLE_POI.id]: SAMPLE_POI },
        stayOverrides: {},
        inProgress: true,
      }),
    );
    const loaded = loadRouteDraft();
    expect(loaded).not.toBeNull();
    expect(loaded?.selectedIds).toEqual(['mne-1', SAMPLE_POI.id]);
    expect(loaded?.selectedCustomStops).toEqual({});
    expect(loaded?.finalDestination).toBeNull();
  });

  it('壊れた自由地点だけを取り除き、他の下書き内容・selectedIdsは保護する（クラッシュしない）', () => {
    localStorage.setItem(
      ROUTE_DRAFT_KEY,
      JSON.stringify({
        ...DEFAULT_ROUTE_DRAFT,
        selectedIds: ['mne-1', 'custom:ok', 'custom:bad'],
        selectedCustomStops: {
          ok: HOTEL,
          bad: { name: 'こわれ', address: 123, lat: 'not-a-number' }, // address/latが型不正
        },
        finalDestination: { name: null, address: 'x', lat: 'oops', lng: 1 }, // 壊れている
      }),
    );
    const loaded = loadRouteDraft();
    expect(loaded).not.toBeNull();
    expect(loaded?.selectedIds).toEqual(['mne-1', 'custom:ok', 'custom:bad']); // 選択IDは保護される
    expect(loaded?.selectedCustomStops.ok).toEqual(HOTEL);
    expect(loaded?.selectedCustomStops.bad).toBeUndefined(); // 壊れた項目のみ除去
    expect(loaded?.finalDestination).toBeNull(); // 壊れているのでnull扱い（下書き全体は拒否しない）
  });
});
