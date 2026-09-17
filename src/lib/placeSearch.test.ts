import { afterEach, describe, expect, it, vi } from 'vitest';
import { dedupeCandidates, nameMatchLevel, searchPlaces, searchStations } from './placeSearch';
import { STATIONS } from '../data';
import * as geocodeModule from './geocode';
import * as nominatimModule from './nominatim';
import { normalizeFacilityQuery } from './nominatim';

/** Nominatim（施設名検索）は既定で空にしておき、必要なテストだけ差し替える */
function mockOsm(
  places: {
    name: string;
    address?: string | null;
    lat: number;
    lng: number;
    kind?: string | null;
    category?: string | null;
    prefecture?: string | null;
    city?: string | null;
    road?: string | null;
  }[] = [],
) {
  return vi.spyOn(nominatimModule, 'searchPlacesByName').mockResolvedValue(
    places.map((p) => ({
      name: p.name,
      address: p.address ?? null,
      lat: p.lat,
      lng: p.lng,
      kind: p.kind ?? null,
      category: p.category ?? null,
      prefecture: p.prefecture ?? null,
      city: p.city ?? null,
      road: p.road ?? null,
    })),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('道の駅名での地点検索（通信なし・アプリ内データ）', () => {
  it('道の駅名の一部で見つかる', () => {
    const hits = searchStations('ふくしま', STATIONS);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].source).toBe('station');
    expect(hits[0].label.startsWith('道の駅')).toBe(true);
  });

  it('「道の駅」を付けて入力しても同じ駅が見つかる', () => {
    const withPrefix = searchStations('道の駅ふくしま', STATIONS);
    const without = searchStations('ふくしま', STATIONS);
    expect(withPrefix.map((h) => h.id)).toEqual(without.map((h) => h.id));
  });

  it('市区町村名でも見つかり、所在地が補足表示に入る', () => {
    const hits = searchStations('秋田市', STATIONS);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].sub).toContain('秋田');
    expect(Number.isFinite(hits[0].lat)).toBe(true);
    expect(Number.isFinite(hits[0].lng)).toBe(true);
  });

  it('空文字では何も返さない', () => {
    expect(searchStations('   ', STATIONS)).toEqual([]);
  });

  it('候補は5件までに抑える（一覧が長くなりすぎないように）', () => {
    expect(searchStations('道', STATIONS).length).toBeLessThanOrEqual(5);
  });
});

describe('名称・住所検索（道の駅 + 国土地理院 住所検索）', () => {
  it('道の駅の候補が先、住所検索の候補が後に並ぶ', async () => {
    mockOsm();
    vi.spyOn(geocodeModule, 'geocode').mockResolvedValue([
      { label: '福島県福島市', lat: 37.76, lng: 140.47 },
    ]);
    const { candidates, geocodeFailed } = await searchPlaces('ふくしま', STATIONS);
    expect(geocodeFailed).toBe(false);
    expect(candidates[0].source).toBe('station');
    expect(candidates[candidates.length - 1].source).toBe('gsi');
  });

  it('複数候補をそのまま返す（勝手に1件へ決め打ちしない）', async () => {
    mockOsm();
    vi.spyOn(geocodeModule, 'geocode').mockResolvedValue([
      { label: '宮城県仙台市太白区郡山', lat: 38.22, lng: 140.89 },
      { label: '山形県東根市郡山', lat: 38.42, lng: 140.36 },
    ]);
    const { candidates } = await searchPlaces('郡山', STATIONS);
    const gsi = candidates.filter((c) => c.source === 'gsi');
    expect(gsi.length).toBe(2);
    expect(new Set(candidates.map((c) => c.id)).size).toBe(candidates.length);
  });

  it('住所検索が0件でも、道の駅が当たっていれば候補を返す', async () => {
    mockOsm();
    vi.spyOn(geocodeModule, 'geocode').mockResolvedValue([]);
    const { candidates, geocodeFailed } = await searchPlaces('ふくしま', STATIONS);
    expect(geocodeFailed).toBe(false);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((c) => c.source === 'station')).toBe(true);
  });

  it('住所検索が通信失敗しても例外を投げず、道の駅の候補は返す', async () => {
    mockOsm();
    vi.spyOn(geocodeModule, 'geocode').mockRejectedValue(new Error('network'));
    const { candidates, geocodeFailed } = await searchPlaces('ふくしま', STATIONS);
    // 片方だけの失敗は「検索失敗」にしない（もう片方の候補を出せるため）
    expect(geocodeFailed).toBe(false);
    expect(candidates.length).toBeGreaterThan(0);
  });

  it('どれも0件なら空で返す（呼び出し側が案内文を出す）', async () => {
    mockOsm();
    vi.spyOn(geocodeModule, 'geocode').mockResolvedValue([]);
    const { candidates } = await searchPlaces('存在しない施設名XYZ', STATIONS);
    expect(candidates).toEqual([]);
  });

  it('空入力では通信しない', async () => {
    const spy = vi.spyOn(geocodeModule, 'geocode').mockResolvedValue([]);
    const osmSpy = mockOsm();
    const { candidates } = await searchPlaces('   ', STATIONS);
    expect(candidates).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    expect(osmSpy).not.toHaveBeenCalled();
  });

  it('施設名（IC・駅・ホテル）はOpenStreetMap側の候補として住所より先に出る', async () => {
    mockOsm([{ name: '郡山IC', address: '東北自動車道 郡山市 福島県', lat: 37.44, lng: 140.32 }]);
    vi.spyOn(geocodeModule, 'geocode').mockResolvedValue([
      { label: '宮城県仙台市太白区郡山', lat: 38.22, lng: 140.89 },
    ]);
    const { candidates, usedOsm } = await searchPlaces('郡山IC', STATIONS);
    expect(usedOsm).toBe(true);
    expect(candidates[0].label).toBe('郡山IC');
    expect(candidates[0].source).toBe('osm');
    expect(candidates[0].sub).toContain('郡山市');
    // 住所検索側の候補も残る（利用者が選べる）
    expect(candidates.some((c) => c.source === 'gsi')).toBe(true);
  });

  it('施設名検索が落ちても住所検索の候補は出す（その逆も同じ）', async () => {
    vi.spyOn(nominatimModule, 'searchPlacesByName').mockRejectedValue(new Error('down'));
    vi.spyOn(geocodeModule, 'geocode').mockResolvedValue([
      { label: '福島県郡山市', lat: 37.4, lng: 140.36 },
    ]);
    const { candidates, geocodeFailed, usedOsm } = await searchPlaces('郡山市', STATIONS);
    expect(geocodeFailed).toBe(false);
    expect(usedOsm).toBe(false);
    expect(candidates.some((c) => c.source === 'gsi')).toBe(true);
  });

  it('両方落ちたときだけ失敗として扱う', async () => {
    vi.spyOn(nominatimModule, 'searchPlacesByName').mockRejectedValue(new Error('down'));
    vi.spyOn(geocodeModule, 'geocode').mockRejectedValue(new Error('down'));
    const { candidates, geocodeFailed } = await searchPlaces('存在しない施設名XYZ', STATIONS);
    expect(geocodeFailed).toBe(true);
    expect(candidates).toEqual([]);
  });

  it('同じ地点が両方から返っても重複表示しない', async () => {
    mockOsm([{ name: '秋田駅', address: '秋田市 秋田県', lat: 39.717, lng: 140.13 }]);
    vi.spyOn(geocodeModule, 'geocode').mockResolvedValue([
      { label: '秋田県秋田市', lat: 39.717, lng: 140.13 },
    ]);
    const { candidates } = await searchPlaces('秋田駅', STATIONS);
    expect(candidates.filter((c) => Math.abs(c.lat - 39.717) < 1e-4).length).toBe(1);
  });
});

describe('日本のドライブ用途に合わせた候補の並べ替え', () => {
  /** Nominatimの実応答に合わせたモック（実測した contract を再現する） */
  const koriyamaIcFukushima = {
    name: '郡山IC',
    lat: 37.44,
    lng: 140.32,
    kind: 'motorway_junction',
    category: 'highway',
    prefecture: '福島県',
    city: '郡山市',
    road: '東北自動車道',
  };
  const koriyamaIcNara = {
    name: '郡山IC',
    lat: 34.64,
    lng: 135.78,
    kind: 'motorway_junction',
    category: 'highway',
    prefecture: '奈良県',
    city: '大和郡山市',
    road: '西名阪自動車道',
  };
  const koriyamaStationFukushima = {
    name: '郡山',
    lat: 37.39,
    lng: 140.38,
    kind: 'station',
    category: 'railway',
    prefecture: '福島県',
    city: '郡山市',
  };
  const koriyamaStationNara = {
    name: '郡山',
    lat: 34.64,
    lng: 135.78,
    kind: 'station',
    category: 'railway',
    prefecture: '奈良県',
    city: '大和郡山市',
  };
  const akitaStation = {
    name: '秋田駅',
    lat: 39.717,
    lng: 140.13,
    kind: 'train_station',
    category: 'railway',
    prefecture: '秋田県',
    city: '秋田市',
  };
  /** 実機で混ざっていた無関係な「郡山」地名（国土地理院側） */
  const placeNames = [
    { label: '宮城県仙台市太白区郡山', lat: 38.22, lng: 140.89 },
    { label: '秋田県羽後町郡山', lat: 39.22, lng: 140.42 },
    { label: '山形県酒田市郡山', lat: 38.9, lng: 139.92 },
  ];

  it('SEARCH-1: 福島県表示中の「郡山IC」は福島県郡山市のICが先頭', async () => {
    mockOsm([koriyamaIcNara, koriyamaIcFukushima]);
    vi.spyOn(geocodeModule, 'geocode').mockResolvedValue(placeNames);
    const { candidates } = await searchPlaces('郡山IC', STATIONS, { prefectures: ['福島県'] });
    expect(candidates[0].label).toBe('郡山IC');
    expect(candidates[0].prefecture).toBe('福島県');
    expect(candidates[0].detail).toContain('東北自動車道');
    expect(candidates[0].sub).toContain('郡山市');
    // 同名の奈良県側も選べる（消さない）
    expect(candidates.some((c) => c.prefecture === '奈良県')).toBe(true);
  });

  it('SEARCH-2: 福島県表示中の「郡山駅」は福島県の駅が先頭で、無関係な地名より上', async () => {
    mockOsm([koriyamaStationNara, koriyamaStationFukushima]);
    vi.spyOn(geocodeModule, 'geocode').mockResolvedValue(placeNames);
    const { candidates } = await searchPlaces('郡山駅', STATIONS, { prefectures: ['福島県'] });
    expect(candidates[0].prefecture).toBe('福島県');
    expect(candidates[0].osmType).toBe('station');
    const firstPlaceName = candidates.findIndex((c) => c.source === 'gsi');
    const firstStation = candidates.findIndex((c) => c.osmCategory === 'railway');
    expect(firstStation).toBeLessThan(firstPlaceName === -1 ? Number.MAX_SAFE_INTEGER : firstPlaceName);
  });

  it('SEARCH-3/4: 「郡山インター」「郡山インターチェンジ」でも郡山ICへ到達できる', async () => {
    for (const q of ['郡山インター', '郡山インターチェンジ']) {
      // 表記を正規化した検索語ぶんも含めて返ってくる状況を再現する
      mockOsm([koriyamaIcFukushima, koriyamaIcNara]);
      vi.spyOn(geocodeModule, 'geocode').mockResolvedValue(placeNames);
      const { candidates } = await searchPlaces(q, STATIONS, { prefectures: ['福島県'] });
      expect(candidates[0].label).toBe('郡山IC');
      expect(candidates[0].prefecture).toBe('福島県');
    }
  });

  it('SEARCH-5: 福島県表示中でも「秋田駅」は秋田県の駅が先頭（県で絞り込まない）', async () => {
    mockOsm([akitaStation]);
    vi.spyOn(geocodeModule, 'geocode').mockResolvedValue([
      { label: '秋田県秋田市', lat: 39.72, lng: 140.1 },
    ]);
    const { candidates } = await searchPlaces('秋田駅', STATIONS, { prefectures: ['福島県'] });
    expect(candidates[0].label).toBe('秋田駅');
    expect(candidates[0].prefecture).toBe('秋田県');
  });

  it('SEARCH-6: 住所検索（施設語を含まない入力）は従来どおり出る', async () => {
    mockOsm([]);
    vi.spyOn(geocodeModule, 'geocode').mockResolvedValue([
      { label: '福島県郡山市安積町', lat: 37.36, lng: 140.34 },
    ]);
    const { candidates } = await searchPlaces('福島県郡山市安積町', STATIONS, { prefectures: ['福島県'] });
    expect(candidates[0].label).toBe('福島県郡山市安積町');
    expect(candidates[0].source).toBe('gsi');
  });

  it('候補は最大5件に抑える', async () => {
    mockOsm([koriyamaIcFukushima, koriyamaIcNara, koriyamaStationFukushima]);
    vi.spyOn(geocodeModule, 'geocode').mockResolvedValue(placeNames);
    const { candidates } = await searchPlaces('郡山', STATIONS, { prefectures: ['福島県'] });
    expect(candidates.length).toBeLessThanOrEqual(5);
  });
});

describe('道路施設の表記ゆれ正規化', () => {
  it('インターチェンジ・インター・ジャンクション等をIC/JCT表記へ寄せる', () => {
    expect(normalizeFacilityQuery('郡山インターチェンジ')).toBe('郡山IC');
    expect(normalizeFacilityQuery('郡山インター')).toBe('郡山IC');
    expect(normalizeFacilityQuery('郡山ジャンクション')).toBe('郡山JCT');
    expect(normalizeFacilityQuery('安積パーキングエリア')).toBe('安積PA');
  });

  it('既にIC表記・無関係な語はそのまま（固有名詞の辞書は持たない）', () => {
    expect(normalizeFacilityQuery('郡山IC')).toBe('郡山IC');
    expect(normalizeFacilityQuery('秋田駅')).toBe('秋田駅');
    expect(normalizeFacilityQuery('インターネットカフェ')).toBe('インターネットカフェ');
  });
});

describe('Final polish: 重複・無関係候補・IC優先', () => {
  /** 実測したNominatim応答（福島県郡山市の郡山ICは出入口で2ノードある） */
  const koriyamaIcA = {
    name: '郡山IC',
    lat: 37.4321257,
    lng: 140.3412414,
    kind: 'motorway_junction',
    category: 'highway',
    prefecture: '福島県',
    city: '郡山市',
    road: '東北自動車道',
  };
  const koriyamaIcB = { ...koriyamaIcA, lat: 37.4373683, lng: 140.3475458 };
  const koriyamaIcNaraA = {
    name: '郡山IC',
    lat: 34.6125264,
    lng: 135.7899172,
    kind: 'motorway_junction',
    category: 'highway',
    prefecture: '奈良県',
    city: '大和郡山市',
    road: '西名阪自動車道',
  };
  const koriyamaIcNaraB = { ...koriyamaIcNaraA, lat: 34.6141592, lng: 135.8033388 };
  /** 「郡山インター」で実際に返ってくる道路 */
  const koriyamaInterRoad = {
    name: '郡山インター線',
    lat: 37.42,
    lng: 140.35,
    kind: 'tertiary',
    category: 'highway',
    prefecture: '福島県',
    city: '郡山市',
    road: null,
  };
  /** 「郡山中央IC」で実際に返ってきた無関係なIC */
  const kayoIc = {
    name: '賀陽IC',
    lat: 34.810803,
    lng: 133.6796592,
    kind: 'motorway_junction',
    category: 'highway',
    prefecture: '岡山県',
    city: '吉備中央町',
  };
  const shoouIc = {
    name: '勝央IC',
    lat: 35.0217389,
    lng: 134.1319388,
    kind: 'motorway_junction',
    category: 'highway',
    prefecture: '岡山県',
    city: '勝央町',
  };

  it('SEARCH-FINAL-1: 「郡山インター」は郡山ICが1位（郡山インター線より上）', async () => {
    mockOsm([koriyamaInterRoad, koriyamaIcA, koriyamaIcB]);
    vi.spyOn(geocodeModule, 'geocode').mockResolvedValue([]);
    const { candidates } = await searchPlaces('郡山インター', STATIONS, { prefectures: ['福島県'] });
    expect(candidates[0].label).toBe('郡山IC');
    expect(candidates[0].prefecture).toBe('福島県');
    // 道路名も候補には残るが下位
    expect(candidates.findIndex((c) => c.label === '郡山インター線')).toBeGreaterThan(0);
  });

  it('SEARCH-FINAL-2: 同じ市区町村の同名ICは1件にまとめる', async () => {
    mockOsm([koriyamaIcA, koriyamaIcB, koriyamaIcNaraA, koriyamaIcNaraB]);
    vi.spyOn(geocodeModule, 'geocode').mockResolvedValue([]);
    const { candidates } = await searchPlaces('郡山IC', STATIONS, { prefectures: ['福島県'] });
    expect(candidates.filter((c) => c.prefecture === '福島県').length).toBe(1);
    expect(candidates.filter((c) => c.prefecture === '奈良県').length).toBe(1);
    expect(candidates[0].prefecture).toBe('福島県');
  });

  it('SEARCH-FINAL-3: 「郡山中央インター」で岡山県の無関係なICを出さない', async () => {
    mockOsm([kayoIc, shoouIc]);
    vi.spyOn(geocodeModule, 'geocode').mockResolvedValue([
      { label: '宮城県仙台市太白区郡山', lat: 38.22, lng: 140.89 },
    ]);
    const { candidates } = await searchPlaces('郡山中央インター', STATIONS, { prefectures: ['福島県'] });
    expect(candidates.some((c) => c.label === '賀陽IC')).toBe(false);
    expect(candidates.some((c) => c.label === '勝央IC')).toBe(false);
    // 名称も県も合わない地名も出さない（0件として案内する方がよい）
    expect(candidates.some((c) => c.prefecture === '宮城県')).toBe(false);
  });

  it('SEARCH-FINAL-5: 名称がはっきり一致していれば県外でも残す', async () => {
    mockOsm([
      {
        name: '秋田駅',
        lat: 39.717,
        lng: 140.13,
        kind: 'train_station',
        category: 'railway',
        prefecture: '秋田県',
        city: '秋田市',
      },
    ]);
    vi.spyOn(geocodeModule, 'geocode').mockResolvedValue([]);
    const { candidates } = await searchPlaces('秋田駅', STATIONS, { prefectures: ['福島県'] });
    expect(candidates[0].label).toBe('秋田駅');
    expect(candidates[0].prefecture).toBe('秋田県');
  });

  it('SEARCH-FINAL-6: 該当が無ければ0件（無理に似た施設を出さない）', async () => {
    mockOsm([]);
    vi.spyOn(geocodeModule, 'geocode').mockResolvedValue([]);
    const { candidates } = await searchPlaces('リブマックス郡山', STATIONS, { prefectures: ['福島県'] });
    expect(candidates).toEqual([]);
  });

  it('全国表示（県の文脈なし）では候補を落とさない', async () => {
    mockOsm([kayoIc]);
    vi.spyOn(geocodeModule, 'geocode').mockResolvedValue([]);
    const { candidates } = await searchPlaces('郡山中央インター', STATIONS, { prefectures: [] });
    expect(candidates.length).toBeGreaterThan(0);
  });
});

describe('名称の一致度と重複判定', () => {
  it('施設語尾を無視して核どうしを比べる', () => {
    expect(nameMatchLevel('郡山インター', '郡山IC')).toBe('exact');
    expect(nameMatchLevel('郡山IC', '郡山IC')).toBe('exact');
    expect(nameMatchLevel('秋田駅', '秋田駅')).toBe('exact');
    expect(nameMatchLevel('郡山中央IC', '郡山IC')).toBe('contains');
    expect(nameMatchLevel('郡山中央IC', '賀陽IC')).toBe('none');
    expect(nameMatchLevel('郡山中央IC', '勝央IC')).toBe('none');
  });

  it('名称が違えば同じ市区町村でも別施設として残す', () => {
    const base = {
      id: 'a',
      sub: '福島県郡山市',
      detail: null,
      source: 'osm' as const,
      prefecture: '福島県',
      osmCategory: 'highway',
      osmType: 'motorway_junction',
    };
    const out = dedupeCandidates([
      { ...base, id: 'a', label: '郡山IC', lat: 37.43, lng: 140.34 },
      { ...base, id: 'b', label: '郡山IC', lat: 37.44, lng: 140.35 },
      { ...base, id: 'c', label: '郡山南IC', lat: 37.36, lng: 140.33 },
    ]);
    expect(out.map((c) => c.label)).toEqual(['郡山IC', '郡山南IC']);
  });
});
