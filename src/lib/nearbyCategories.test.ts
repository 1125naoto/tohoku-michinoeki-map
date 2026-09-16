import { describe, expect, it } from 'vitest';
import {
  CATEGORY_ICON,
  NEARBY_CATEGORIES,
  municipalityFor,
  nearbyCategoryQuery,
  nearbyCategorySearchUrl,
} from './nearbyCategories';
import { STATIONS } from '../data';
import type { Station } from '../types';

const AKITA_PORT = STATIONS.find((s) => s.name === 'あきた港')!;

/** 指定カテゴリの指定サブカテゴリを取り出す（見つからなければテストを落とす） */
function sub(category: keyof typeof NEARBY_CATEGORIES, key: string) {
  const found = NEARBY_CATEGORIES[category].find((c) => c.key === key);
  expect(found, `${category}/${key} が定義されていない`).toBeTruthy();
  return found!;
}

describe('周辺スポットのアイコン付きサブカテゴリ', () => {
  it('大カテゴリ4つにアイコンが揃っている', () => {
    expect(CATEGORY_ICON.food).toBe('🍴');
    expect(CATEGORY_ICON.tourism).toBe('🗺️');
    expect(CATEGORY_ICON.onsen).toBe('♨️');
    expect(CATEGORY_ICON.lodging).toBe('🏨');
  });

  it('食べる: ラーメン/寿司/焼肉/カレー/麺・パスタ/カフェ/スイーツ/居酒屋/その他', () => {
    expect(NEARBY_CATEGORIES.food.map((c) => c.label)).toEqual([
      'ラーメン',
      '寿司',
      '焼肉',
      'カレー',
      '麺・パスタ',
      'カフェ',
      'スイーツ',
      '居酒屋',
      'その他・飲食店',
    ]);
  });

  it('観光: 神社/寺・仏閣/城・史跡/名所・絶景/博物館・美術館/公園/レジャー', () => {
    expect(NEARBY_CATEGORIES.tourism.map((c) => c.label)).toEqual([
      '神社',
      '寺・仏閣',
      '城・史跡',
      '名所・絶景',
      '博物館・美術館',
      '公園',
      'レジャー',
    ]);
  });

  it('温泉: 日帰り温泉/サウナ・スーパー銭湯/温泉全般', () => {
    expect(NEARBY_CATEGORIES.onsen.map((c) => c.label)).toEqual([
      '日帰り温泉',
      'サウナ・スーパー銭湯',
      '温泉全般',
    ]);
  });

  it('宿泊: ホテル/旅館/キャンプ場/RVパーク', () => {
    expect(NEARBY_CATEGORIES.lodging.map((c) => c.label)).toEqual([
      'ホテル',
      '旅館',
      'キャンプ場',
      'RVパーク',
    ]);
  });

  it('すべてのサブカテゴリにアイコンと検索語がある', () => {
    for (const list of Object.values(NEARBY_CATEGORIES)) {
      for (const c of list) {
        expect(c.icon.length).toBeGreaterThan(0);
        expect(c.query.length).toBeGreaterThan(0);
        expect(c.key.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('Googleマップのカテゴリ検索（カテゴリ語 + 市区町村）', () => {
  it('市区町村は道の駅データのcityをそのまま使う（あきた港＝秋田市）', () => {
    expect(AKITA_PORT.city).toBe('秋田市');
    expect(municipalityFor(AKITA_PORT)).toBe('秋田市');
  });

  it('CASE B: ラーメン → 「ラーメン 秋田市」', () => {
    expect(nearbyCategoryQuery(AKITA_PORT, sub('food', 'ramen'))).toBe('ラーメン 秋田市');
  });

  it('CASE C: 寿司 → 「寿司 秋田市」', () => {
    expect(nearbyCategoryQuery(AKITA_PORT, sub('food', 'sushi'))).toBe('寿司 秋田市');
  });

  it('CASE E: 神社 → 「神社 秋田市」', () => {
    expect(nearbyCategoryQuery(AKITA_PORT, sub('tourism', 'jinja'))).toBe('神社 秋田市');
  });

  it('日帰り温泉 → 「日帰り温泉 秋田市」', () => {
    expect(nearbyCategoryQuery(AKITA_PORT, sub('onsen', 'higaeri'))).toBe('日帰り温泉 秋田市');
  });

  it('ホテル → 「ホテル 秋田市」', () => {
    expect(nearbyCategoryQuery(AKITA_PORT, sub('lodging', 'hotel'))).toBe('ホテル 秋田市');
  });

  it('検索語に道の駅名を混ぜない（Place詳細へ寄らせない）', () => {
    for (const list of Object.values(NEARBY_CATEGORIES)) {
      for (const c of list) {
        const q = nearbyCategoryQuery(AKITA_PORT, c);
        expect(q).not.toContain('道の駅');
        expect(q).not.toContain(AKITA_PORT.name);
        expect(q).toContain('秋田市');
      }
    }
  });

  it('URLはGoogle Maps URLs公式のSearch action形式（api=1&query=）', () => {
    const url = nearbyCategorySearchUrl(AKITA_PORT, sub('food', 'ramen'));
    expect(url.startsWith('https://www.google.com/maps/search/?api=1&query=')).toBe(true);
    expect(decodeURIComponent(url)).toBe(
      'https://www.google.com/maps/search/?api=1&query=ラーメン 秋田市',
    );
  });

  it('非公式な指定（生の緯度経度連結・/@・near・viewport hack）を含まない', () => {
    for (const list of Object.values(NEARBY_CATEGORIES)) {
      for (const c of list) {
        const url = nearbyCategorySearchUrl(AKITA_PORT, c);
        expect(url).not.toContain('/@');
        expect(url).not.toContain('near');
        expect(url).not.toMatch(/\d{1,3}\.\d{4,},\d{1,3}\.\d{4,}/);
        expect(url).not.toContain('maps.googleapis.com');
      }
    }
  });

  it('CASE I: 市区町村が空のデータでは都道府県、それも無ければ住所へ安全に下げる', () => {
    const noCity = { ...AKITA_PORT, city: '  ' } as Station;
    expect(municipalityFor(noCity)).toBe('秋田県');
    expect(nearbyCategoryQuery(noCity, sub('food', 'ramen'))).toBe('ラーメン 秋田県');

    const noCityNoPref = { ...AKITA_PORT, city: '', pref: '' as Station['pref'], address: '秋田県秋田市土崎港西1-9-1' };
    expect(municipalityFor(noCityNoPref)).toBe('秋田県秋田市土崎港西1-9-1');

    const nothing = { ...AKITA_PORT, city: '', pref: '' as Station['pref'], address: '' };
    expect(municipalityFor(nothing)).toBe('');
    // 地域名が取れなくてもカテゴリ語だけで成立し、道の駅名は混ぜない
    expect(nearbyCategoryQuery(nothing, sub('food', 'ramen'))).toBe('ラーメン');
  });

  it('全国どの道の駅でも市区町村が取得でき、検索語が空にならない', () => {
    const missing = STATIONS.filter((s) => municipalityFor(s) === '');
    expect(missing).toEqual([]);
  });
});
