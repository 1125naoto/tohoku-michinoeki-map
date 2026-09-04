import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STAY_MIN,
  classify,
  dedupePois,
  normalizeOsmElement,
  poiDisplayName,
  poiGoogleSearchUrl,
  roundStayMin,
  stopTypeOf,
  type OsmElement,
} from './poi';

describe('カテゴリ分類（OSMタグから）', () => {
  it('ラーメン店を分類する', () => {
    expect(classify({ amenity: 'restaurant', cuisine: 'ramen' })).toEqual({ category: 'food', subcategory: 'ramen' });
  });
  it('カフェを分類する', () => {
    expect(classify({ amenity: 'cafe' })).toEqual({ category: 'food', subcategory: 'cafe' });
  });
  it('cuisineが無い一般レストランは「その他の飲食店」', () => {
    expect(classify({ amenity: 'restaurant' })).toEqual({ category: 'food', subcategory: 'food_other' });
  });
  it('温泉(natural=hot_spring)を分類する', () => {
    expect(classify({ natural: 'hot_spring' })).toEqual({ category: 'onsen', subcategory: 'onsen' });
  });
  it('日帰り温泉(amenity=public_bath)を分類する', () => {
    expect(classify({ amenity: 'public_bath' })).toEqual({ category: 'onsen', subcategory: 'higaeri_onsen' });
  });
  it('足湯(amenity=foot_bath)を分類する', () => {
    expect(classify({ amenity: 'foot_bath' })).toEqual({ category: 'onsen', subcategory: 'ashiyu' });
  });
  it('神社(religion=shinto)を分類する', () => {
    expect(classify({ amenity: 'place_of_worship', religion: 'shinto' })).toEqual({
      category: 'tourism',
      subcategory: 'jinja_tera',
    });
  });
  it('観光名所(tourism=attraction)を分類する', () => {
    expect(classify({ tourism: 'attraction' })).toEqual({ category: 'tourism', subcategory: 'meisho' });
  });
  it('公園(leisure=park)を分類する', () => {
    expect(classify({ leisure: 'park' })).toEqual({ category: 'tourism', subcategory: 'koen' });
  });
  it('分類できないタグはnull（推測で断定しない）', () => {
    expect(classify({ shop: 'supermarket' })).toBeNull();
    expect(classify({})).toBeNull();
  });
});

describe('OSM要素の正規化', () => {
  const origin = { lat: 37.4, lng: 140.36 };

  it('通常のnode要素を正規化する', () => {
    const el: OsmElement = {
      type: 'node',
      id: 12345,
      lat: 37.41,
      lon: 140.37,
      tags: { amenity: 'cafe', name: 'カフェ郡山', 'addr:city': '郡山市', 'addr:street': '本町' },
    };
    const poi = normalizeOsmElement(el, origin);
    expect(poi).not.toBeNull();
    expect(poi!.id).toBe('osm:node/12345');
    expect(poi!.name).toBe('カフェ郡山');
    expect(poi!.address).toContain('郡山市');
    expect(poi!.distanceM).toBeGreaterThan(0);
    expect(poi!.sourceUrl).toContain('openstreetmap.org/node/12345');
  });

  it('名称なしのnode要素はname=nullで正規化される（アプリを落とさない）', () => {
    const el: OsmElement = { type: 'node', id: 1, lat: 37.41, lon: 140.37, tags: { amenity: 'cafe' } };
    const poi = normalizeOsmElement(el, origin);
    expect(poi).not.toBeNull();
    expect(poi!.name).toBeNull();
    expect(poiDisplayName(poi!)).toContain('カフェ');
  });

  it('住所タグが無ければaddressはnull', () => {
    const el: OsmElement = { type: 'node', id: 2, lat: 37.41, lon: 140.37, tags: { amenity: 'cafe' } };
    const poi = normalizeOsmElement(el, origin);
    expect(poi!.address).toBeNull();
  });

  it('opening_hoursが無ければopeningHoursRawはnull（推測で埋めない）', () => {
    const el: OsmElement = { type: 'node', id: 3, lat: 37.41, lon: 140.37, tags: { amenity: 'cafe' } };
    const poi = normalizeOsmElement(el, origin);
    expect(poi!.openingHoursRaw).toBeNull();
  });

  it('opening_hoursがあれば原文をそのまま保持する', () => {
    const el: OsmElement = {
      type: 'node',
      id: 4,
      lat: 37.41,
      lon: 140.37,
      tags: { amenity: 'cafe', opening_hours: 'Mo-Fr 09:00-18:00' },
    };
    const poi = normalizeOsmElement(el, origin);
    expect(poi!.openingHoursRaw).toBe('Mo-Fr 09:00-18:00');
  });

  it('分類不能な要素はnullを返す（呼び出し側で除外）', () => {
    const el: OsmElement = { type: 'node', id: 5, lat: 37.41, lon: 140.37, tags: { shop: 'supermarket' } };
    expect(normalizeOsmElement(el, origin)).toBeNull();
  });

  it('座標が取れない要素はnullを返す', () => {
    const el: OsmElement = { type: 'way', id: 6, tags: { amenity: 'cafe' } };
    expect(normalizeOsmElement(el, origin)).toBeNull();
  });

  it('way要素はcenterの座標を使う', () => {
    const el: OsmElement = {
      type: 'way',
      id: 7,
      center: { lat: 37.42, lon: 140.38 },
      tags: { highway: 'rest_area' },
    };
    const poi = normalizeOsmElement(el, origin);
    expect(poi).not.toBeNull();
    expect(poi!.lat).toBe(37.42);
    expect(poi!.id).toBe('osm:way/7');
  });

  it('relation要素もcenterの座標を使い、IDにrelationを含む', () => {
    const el: OsmElement = {
      type: 'relation',
      id: 8,
      center: { lat: 37.43, lon: 140.39 },
      tags: { tourism: 'museum', name: '資料館' },
    };
    const poi = normalizeOsmElement(el, origin);
    expect(poi).not.toBeNull();
    expect(poi!.lat).toBe(37.43);
    expect(poi!.id).toBe('osm:relation/8');
    expect(poi!.sourceUrl).toContain('openstreetmap.org/relation/8');
  });

  it('name:jaタグがあれば汎用nameより優先する', () => {
    const el: OsmElement = {
      type: 'node',
      id: 9,
      lat: 37.41,
      lon: 140.37,
      tags: { amenity: 'cafe', name: 'Cafe Example', 'name:ja': 'カフェ・イグザンプル' },
    };
    const poi = normalizeOsmElement(el, origin);
    expect(poi!.name).toBe('カフェ・イグザンプル');
  });

  it('name:jaが無ければ汎用nameを使う', () => {
    const el: OsmElement = { type: 'node', id: 10, lat: 37.41, lon: 140.37, tags: { amenity: 'cafe', name: 'Cafe Example' } };
    const poi = normalizeOsmElement(el, origin);
    expect(poi!.name).toBe('Cafe Example');
  });

  it('phone/websiteはタグがある場合のみ保持する（無ければnull）', () => {
    const withContact = normalizeOsmElement(
      { type: 'node', id: 11, lat: 37.41, lon: 140.37, tags: { amenity: 'cafe', phone: '024-000-0000', website: 'https://example.com' } },
      origin,
    );
    expect(withContact!.phone).toBe('024-000-0000');
    expect(withContact!.website).toBe('https://example.com');

    const withoutContact = normalizeOsmElement({ type: 'node', id: 12, lat: 37.41, lon: 140.37, tags: { amenity: 'cafe' } }, origin);
    expect(withoutContact!.phone).toBeNull();
    expect(withoutContact!.website).toBeNull();
  });

  it('contact:phone/contact:websiteもphone/websiteが無い場合のフォールバックとして使う', () => {
    const el: OsmElement = {
      type: 'node',
      id: 13,
      lat: 37.41,
      lon: 140.37,
      tags: { amenity: 'cafe', 'contact:phone': '024-111-1111', 'contact:website': 'https://example.jp' },
    };
    const poi = normalizeOsmElement(el, origin);
    expect(poi!.phone).toBe('024-111-1111');
    expect(poi!.website).toBe('https://example.jp');
  });
});

describe('重複除外（dedupePois）', () => {
  const origin = { lat: 37.4, lng: 140.36 };
  it('同じ名前・ほぼ同じ座標の要素は1件にまとめる（近い方を残す）', () => {
    const near = normalizeOsmElement(
      { type: 'node', id: 1, lat: 37.4001, lon: 140.3601, tags: { amenity: 'cafe', name: '同じ店' } },
      origin,
    )!;
    const far = normalizeOsmElement(
      { type: 'way', id: 2, center: { lat: 37.4001, lon: 140.3601 }, tags: { amenity: 'cafe', name: '同じ店' } },
      { lat: 37.5, lng: 140.5 }, // 別のoriginから計算した遠いdistanceMを持たせる
    )!;
    const result = dedupePois([far, near]);
    expect(result.length).toBe(1);
    expect(result[0].distanceM).toBe(near.distanceM);
  });

  it('名前や座標が異なれば別施設として残す', () => {
    const a = normalizeOsmElement({ type: 'node', id: 1, lat: 37.4001, lon: 140.3601, tags: { amenity: 'cafe', name: '店A' } }, origin)!;
    const b = normalizeOsmElement({ type: 'node', id: 2, lat: 37.4101, lon: 140.3701, tags: { amenity: 'cafe', name: '店B' } }, origin)!;
    expect(dedupePois([a, b]).length).toBe(2);
  });
});

describe('立ち寄り先の内部種別（stopType）', () => {
  it('食べる系はrestaurant、カフェはcafe', () => {
    expect(stopTypeOf('ramen')).toBe('restaurant');
    expect(stopTypeOf('cafe')).toBe('cafe');
  });
  it('温泉系はonsen', () => {
    expect(stopTypeOf('onsen')).toBe('onsen');
    expect(stopTypeOf('ashiyu')).toBe('onsen');
  });
  it('公園・景勝地はpark', () => {
    expect(stopTypeOf('koen')).toBe('park');
    expect(stopTypeOf('keishou')).toBe('park');
  });
  it('その他の観光はtourism', () => {
    expect(stopTypeOf('meisho')).toBe('tourism');
    expect(stopTypeOf('jinja_tera')).toBe('tourism');
  });
});

describe('滞在時間の既定値と丸め', () => {
  it('道の駅30分・ラーメン45分・温泉90分などの初期値を持つ', () => {
    expect(DEFAULT_STAY_MIN.station).toBe(30);
    expect(DEFAULT_STAY_MIN.ramen).toBe(45);
    expect(DEFAULT_STAY_MIN.onsen).toBe(90);
    expect(DEFAULT_STAY_MIN.jinja_tera).toBe(45);
  });
  it('任意入力は15分単位に丸める', () => {
    expect(roundStayMin(50)).toBe(45);
    expect(roundStayMin(53)).toBe(60);
  });
  it('不正な値でも安全な範囲に収める（エラーにしない）', () => {
    expect(roundStayMin(NaN)).toBe(30);
    expect(roundStayMin(-10)).toBe(15);
    expect(roundStayMin(9999)).toBe(240);
  });
});

describe('Googleマップ検索URL', () => {
  it('名称と住所があればそれを使う', () => {
    const poi = normalizeOsmElement(
      { type: 'node', id: 1, lat: 37.4, lon: 140.36, tags: { amenity: 'cafe', name: 'テストカフェ', 'addr:city': '郡山市' } },
      { lat: 37.4, lng: 140.36 },
    )!;
    const url = poiGoogleSearchUrl(poi);
    expect(decodeURIComponent(url)).toContain('テストカフェ');
    expect(decodeURIComponent(url)).toContain('郡山市');
  });
  it('名称が無ければ座標で検索する', () => {
    const poi = normalizeOsmElement(
      { type: 'node', id: 1, lat: 37.4, lon: 140.36, tags: { amenity: 'cafe' } },
      { lat: 37.4, lng: 140.36 },
    )!;
    const url = poiGoogleSearchUrl(poi);
    expect(url).toContain('37.4');
  });
});
