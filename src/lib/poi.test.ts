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
  it('ラーメン店を分類する（cuisine=ramen）', () => {
    expect(classify({ amenity: 'restaurant', cuisine: 'ramen' })).toEqual({
      category: 'food',
      subcategory: 'ramen',
      subcategories: ['ramen'],
    });
  });
  it('カフェを分類する', () => {
    expect(classify({ amenity: 'cafe' })).toEqual({ category: 'food', subcategory: 'cafe', subcategories: ['cafe'] });
  });
  it('cuisineも店名の手がかりも無い一般レストランは「その他の飲食店」', () => {
    expect(classify({ amenity: 'restaurant' })).toEqual({
      category: 'food',
      subcategory: 'food_other',
      subcategories: ['food_other'],
    });
  });
  it('温泉(natural=hot_spring)を分類する', () => {
    expect(classify({ natural: 'hot_spring' })).toEqual({ category: 'onsen', subcategory: 'onsen', subcategories: ['onsen'] });
  });
  it('日帰り温泉(amenity=public_bath)を分類する（温泉由来を示すタグ・店名が無い場合は日帰り温泉のみ）', () => {
    expect(classify({ amenity: 'public_bath' })).toEqual({
      category: 'onsen',
      subcategory: 'higaeri_onsen',
      subcategories: ['higaeri_onsen'],
    });
  });
  it('足湯(amenity=foot_bath)を分類する', () => {
    expect(classify({ amenity: 'foot_bath' })).toEqual({ category: 'onsen', subcategory: 'ashiyu', subcategories: ['ashiyu'] });
  });
  it('神社(religion=shinto)を分類する', () => {
    expect(classify({ amenity: 'place_of_worship', religion: 'shinto' })).toEqual({
      category: 'tourism',
      subcategory: 'jinja_tera',
      subcategories: ['jinja_tera'],
    });
  });
  it('観光名所(tourism=attraction)を分類する', () => {
    expect(classify({ tourism: 'attraction' })).toEqual({ category: 'tourism', subcategory: 'meisho', subcategories: ['meisho'] });
  });
  it('公園(leisure=park)を分類する', () => {
    expect(classify({ leisure: 'park' })).toEqual({ category: 'tourism', subcategory: 'koen', subcategories: ['koen'] });
  });
  it('分類できないタグはnull（推測で断定しない）', () => {
    expect(classify({ shop: 'supermarket' })).toBeNull();
    expect(classify({})).toBeNull();
  });
  it('ホテル(tourism=hotel/motel)を分類する', () => {
    expect(classify({ tourism: 'hotel' })).toEqual({ category: 'lodging', subcategory: 'hotel', subcategories: ['hotel'] });
    expect(classify({ tourism: 'motel' })).toEqual({ category: 'lodging', subcategory: 'hotel', subcategories: ['hotel'] });
  });
  it('旅館・民宿(tourism=guest_house)を分類する', () => {
    expect(classify({ tourism: 'guest_house' })).toEqual({
      category: 'lodging',
      subcategory: 'guesthouse',
      subcategories: ['guesthouse'],
    });
  });
  it('ゲストハウス(tourism=hostel)を分類する', () => {
    expect(classify({ tourism: 'hostel' })).toEqual({ category: 'lodging', subcategory: 'hostel', subcategories: ['hostel'] });
  });

  describe('実地テストで報告された不具合の回帰: 飲食ジャンルの細分類', () => {
    // 実データ監査（181駅・5222件）で、cuisineタグが無い/一致しないために
    // 実在するラーメン店・寿司店等が軒並み「その他の飲食店」「ファストフード」に
    // 埋もれていたことを確認済み（例: 「ラーメンショップ」「大ちゃんラーメン」等70件、
    // 「想い出寿司」「かっぱ寿司」等55件）。
    it('amenity=fast_food + cuisine=ramen はラーメンに分類される（従来はfast_food判定がcuisineより先に確定し常にfastfood固定だった）', () => {
      expect(classify({ amenity: 'fast_food', cuisine: 'ramen' })).toEqual({
        category: 'food',
        subcategory: 'ramen',
        subcategories: ['ramen'],
      });
    });
    it('cuisineタグが無くても、店名に「ラーメン」を含むrestaurantはラーメンに分類される', () => {
      expect(classify({ amenity: 'restaurant', name: 'ラーメン一休' })).toEqual({
        category: 'food',
        subcategory: 'ramen',
        subcategories: ['ramen'],
      });
      expect(classify({ amenity: 'restaurant', name: '中華そば 酔月' })).toEqual({
        category: 'food',
        subcategory: 'ramen',
        subcategories: ['ramen'],
      });
    });
    it('実データ監査（仙台/盛岡/山形）で確認したラーメン店名パターンを分類する', () => {
      const ramenNames = [
        'らぁめん花月',
        '拉麺 三國志',
        '仙台中華蕎麦 仁屋',
        '支那そば 龍軒',
        'つけ麺おんのじ 仙台本店',
        '油そば 春日亭',
        '麺屋政宗',
        '麺処 誠',
        '麺房おおはら',
        '麺工房 大地',
        'RAMEN JIRO',
        '一蘭',
        '町田商店',
      ];
      for (const name of ramenNames) {
        expect(classify({ amenity: 'restaurant', name })?.subcategory).toBe('ramen');
      }
    });
    it('cuisine=noodleや「麺」を含む名前でも、実際は非ラーメン店（そば/うどん/パスタ/麻辣湯）は誤分類しない', () => {
      // cuisine=noodle は実データ上そば/うどん/麻辣湯にも付与されているため、
      // それ自体では ramen 判定しない（店名側の高精度キーワードが無ければ null のまま）。
      expect(classify({ amenity: 'restaurant', cuisine: 'noodle', name: 'そばの神田 東一屋' })?.subcategory).not.toBe(
        'ramen',
      );
      expect(classify({ amenity: 'fast_food', cuisine: 'noodle', name: '丸亀製麺' })?.subcategory).not.toBe('ramen');
      expect(classify({ amenity: 'restaurant', cuisine: 'chinese', name: '七宝麻辣湯' })?.subcategory).not.toBe(
        'ramen',
      );
      // 「麺屋」は店名の先頭にある場合のみラーメンとみなす。先頭以外（洋麺屋＝パスタ店）は誤分類しない。
      expect(classify({ amenity: 'restaurant', cuisine: 'pasta', name: '洋麺屋五右衛門' })?.subcategory).not.toBe(
        'ramen',
      );
      expect(classify({ amenity: 'restaurant', cuisine: 'soba', name: '生そば 福はら' })?.subcategory).not.toBe(
        'ramen',
      );
    });
    it('cuisineタグが無くても、店名に「寿司」を含むrestaurantは寿司に分類される', () => {
      expect(classify({ amenity: 'restaurant', name: '想い出寿司' })).toEqual({
        category: 'food',
        subcategory: 'sushi',
        subcategories: ['sushi'],
      });
    });
    it('cuisineタグが無くても、店名に「焼肉」を含むrestaurantは焼肉に分類される', () => {
      expect(classify({ amenity: 'restaurant', name: '焼肉たろう' })).toEqual({
        category: 'food',
        subcategory: 'yakiniku',
        subcategories: ['yakiniku'],
      });
    });
    it('cuisineタグがある場合は店名より優先される（店名にラーメンを含んでも実際のcuisineを信じる）', () => {
      expect(classify({ amenity: 'restaurant', cuisine: 'italian', name: 'ラーメン風イタリアン' })).toEqual({
        category: 'food',
        subcategory: 'italian',
        subcategories: ['italian'],
      });
    });
    it('店名にも手がかりが無いfast_foodは従来通りファストフードのまま', () => {
      expect(classify({ amenity: 'fast_food', name: 'マクドナルド' })).toEqual({
        category: 'food',
        subcategory: 'fastfood',
        subcategories: ['fastfood'],
      });
    });
  });

  describe('Owner実機QA回帰: 道の駅ふくしま10km「洋食」0件バグ（全国cache実データ監査、POI_SCHEMA_VERSION v4）', () => {
    // 全国1235駅cache実データ監査（2026-09-15）: cuisine=westernはほぼ使われて
    // おらず（福島市街地10km圏の実測133件中0件）、cuisine由来のyoshoku判定
    // だけでは実在する洋食店が軒並み「その他の飲食店」に埋もれていた。
    it('cuisine=westernは引き続き洋食に分類される（既存挙動を壊さない）', () => {
      expect(classify({ amenity: 'restaurant', cuisine: 'western' })).toEqual({
        category: 'food',
        subcategory: 'yoshoku',
        subcategories: ['yoshoku'],
      });
    });
    it('cuisineタグが無くても、店名から洋食店と高精度に判定できる語を含むrestaurantは洋食に分類される', () => {
      const yoshokuNames = ['ビストロ波平', '洋食屋シカレ', '洋食 TANTO', 'ステーキのどん', 'グリルけやき亭', '山形フレンチ シェ・ボン'];
      for (const name of yoshokuNames) {
        expect(classify({ amenity: 'restaurant', name })).toEqual({
          category: 'food',
          subcategory: 'yoshoku',
          subcategories: ['yoshoku'],
        });
      }
    });
    it('「レストラン」単体では洋食に分類しない（中華・和食系ファミレス等も広く名乗るため誤分類リスクが高い）', () => {
      expect(classify({ amenity: 'restaurant', name: 'ファミリーレストラン花月' })?.subcategory).not.toBe('yoshoku');
    });
    it('cuisineタグが無くても、店名に「居酒屋」を含むbar/restaurantは居酒屋に分類される（全国cache監査でfood_otherに601件埋没を確認）', () => {
      expect(classify({ amenity: 'restaurant', name: '居酒屋 あひる' })).toEqual({
        category: 'food',
        subcategory: 'izakaya',
        subcategories: ['izakaya'],
      });
      expect(classify({ amenity: 'bar', name: 'ダイニング居酒屋 優' })).toEqual({
        category: 'food',
        subcategory: 'izakaya',
        subcategories: ['izakaya'],
      });
    });
    it('cuisineタグが無くても、店名に「食堂」を含むrestaurantは食堂に分類される（全国cache監査でfood_otherに1189件埋没を確認）', () => {
      expect(classify({ amenity: 'restaurant', name: 'かもめ食堂' })).toEqual({
        category: 'food',
        subcategory: 'shokudo',
        subcategories: ['shokudo'],
      });
    });
    it('cuisineタグが無くても、店名にピザ/パスタ/イタリアンを含むrestaurantはイタリアンに分類される', () => {
      expect(classify({ amenity: 'restaurant', name: 'ニセコピザ' })).toEqual({
        category: 'food',
        subcategory: 'italian',
        subcategories: ['italian'],
      });
      expect(classify({ amenity: 'restaurant', name: 'パスタ工房' })?.subcategory).toBe('italian');
    });
    it('「焼肉食堂」のように複数ジャンル語を含む店名は、より先に判定される焼肉が優先される（食堂に誤って落ちない）', () => {
      expect(classify({ amenity: 'restaurant', name: '焼肉食堂まるは' })).toEqual({
        category: 'food',
        subcategory: 'yakiniku',
        subcategories: ['yakiniku'],
      });
    });
    it('cuisineタグがある場合は新しい店名判定より優先される', () => {
      expect(classify({ amenity: 'restaurant', cuisine: 'sushi', name: '洋食寿司 波平' })).toEqual({
        category: 'food',
        subcategory: 'sushi',
        subcategories: ['sushi'],
      });
    });
    it('複数cuisine値（;区切り）は前方の既知ジャンルが一致すれば分類できる', () => {
      expect(classify({ amenity: 'restaurant', cuisine: 'japanese;chinese' })?.subcategory).toBe('shokudo');
    });
    it('cuisine/店名のどちらにも手がかりが無いrestaurantは、引き続きその他の飲食店のまま（誤って洋食等に落とさない）', () => {
      expect(classify({ amenity: 'restaurant', name: 'あづまキッチン' })).toEqual({
        category: 'food',
        subcategory: 'food_other',
        subcategories: ['food_other'],
      });
      expect(classify({ amenity: 'restaurant' })).toEqual({
        category: 'food',
        subcategory: 'food_other',
        subcategories: ['food_other'],
      });
    });
  });

  describe('実地テストで報告された不具合の回帰: 温泉・日帰り温泉の多重所属', () => {
    // 実データ監査で「日帰り温泉」に119件あるのに「温泉」細分類には1件しか
    // 無いことを確認（natural=hot_springは温泉施設にはほぼ付かない）。
    // ライブAPI確認でも、amenity=public_bathの温泉施設の大半にbath:typeタグが
    // 無いことを確認したため、店名の「温泉」も高精度な補助シグナルとして使う。
    it('bath:type=onsen の日帰り入浴施設は「日帰り温泉」と「温泉」の両方に属する', () => {
      expect(classify({ amenity: 'public_bath', 'bath:type': 'onsen', name: 'ポニー温泉' })).toEqual({
        category: 'onsen',
        subcategory: 'higaeri_onsen',
        subcategories: ['higaeri_onsen', 'onsen'],
      });
    });
    it('bath:typeが無くても店名に「温泉」を含む公衆浴場は「日帰り温泉」と「温泉」の両方に属する', () => {
      expect(classify({ amenity: 'public_bath', name: '木崎野温泉' })).toEqual({
        category: 'onsen',
        subcategory: 'higaeri_onsen',
        subcategories: ['higaeri_onsen', 'onsen'],
      });
    });
    it('温泉由来を示す手がかりが無い公衆浴場は従来通り「日帰り温泉」のみ', () => {
      expect(classify({ amenity: 'public_bath', name: '六ヶ所村老人福祉センター' })).toEqual({
        category: 'onsen',
        subcategory: 'higaeri_onsen',
        subcategories: ['higaeri_onsen'],
      });
    });
    it('店名に「温泉」を含むspa施設も「温浴施設」と「温泉」の両方に属する', () => {
      expect(classify({ leisure: 'spa', name: 'XXスパ温泉' })).toEqual({
        category: 'onsen',
        subcategory: 'onyoku_shisetsu',
        subcategories: ['onyoku_shisetsu', 'onsen'],
      });
    });
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
  it('宿泊系はlodging', () => {
    expect(stopTypeOf('hotel')).toBe('lodging');
    expect(stopTypeOf('guesthouse')).toBe('lodging');
    expect(stopTypeOf('hostel')).toBe('lodging');
    expect(stopTypeOf('lodging_other')).toBe('lodging');
  });
});

describe('滞在時間の既定値と丸め', () => {
  it('道の駅30分・ラーメン45分・温泉90分などの初期値を持つ', () => {
    expect(DEFAULT_STAY_MIN.station).toBe(30);
    expect(DEFAULT_STAY_MIN.ramen).toBe(45);
    expect(DEFAULT_STAY_MIN.onsen).toBe(90);
    expect(DEFAULT_STAY_MIN.jinja_tera).toBe(45);
    expect(DEFAULT_STAY_MIN.hotel).toBe(480);
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
