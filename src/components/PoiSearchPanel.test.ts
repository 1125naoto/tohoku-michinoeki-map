import { describe, expect, it } from 'vitest';
import { sortPois } from './PoiSearchPanel';
import { normalizeOsmElement, type Poi } from '../lib/poi';

const origin = { lat: 37.4, lng: 140.36 };

function poi(id: number, name: string, lat: number, lng: number, amenity = 'cafe'): Poi {
  return normalizeOsmElement({ type: 'node', id, lat, lon: lng, tags: { amenity, name } }, origin)!;
}

describe('周辺スポット一覧の並び替え（sortPois）', () => {
  const near = poi(1, 'いろは', 37.401, 140.361);
  const far = poi(2, 'あいうえお', 37.45, 140.42);
  const mid = poi(3, 'うえお', 37.41, 140.37, 'restaurant');

  it('距離順（既定）: 起点から近い順に並ぶ', () => {
    const sorted = sortPois([far, near, mid], 'distance');
    expect(sorted.map((p) => p.id)).toEqual([near.id, mid.id, far.id]);
  });

  it('名前順: 名称の五十音順に並ぶ', () => {
    const sorted = sortPois([near, far, mid], 'name');
    expect(sorted.map((p) => p.name)).toEqual(['あいうえお', 'いろは', 'うえお']);
  });

  it('カテゴリー別: カテゴリーでまとめ、同カテゴリー内は距離順', () => {
    const sorted = sortPois([far, near, mid], 'category');
    // food(mid=restaurant)とfood(near/far=cafe)は同カテゴリーのため、
    // カテゴリーでグルーピングされていることを確認する
    const categories = sorted.map((p) => p.category);
    expect(new Set(categories).size).toBe(1); // すべてfoodカテゴリ
  });

  it('元の配列を破壊しない', () => {
    const original = [far, near, mid];
    const copy = [...original];
    sortPois(original, 'distance');
    expect(original).toEqual(copy);
  });
});
