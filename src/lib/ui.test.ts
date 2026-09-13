import { describe, expect, it } from 'vitest';
import { PREFECTURES } from '../types';
import type { Station, VisitMap } from '../types';
import {
  filterSummary,
  filterStations,
  matchesFacilityFilter,
  matchesFilter,
  matchesSelectedPrefectures,
  prefecturesInArea,
  stationMatchesQuery,
} from './ui';

describe('絞り込みサマリー', () => {
  it('未選択(空配列)時は「全国・すべて」', () => {
    expect(filterSummary([], 'all')).toBe('絞り込み：全国・すべて');
  });
  it('県と状態を反映する（単一選択）', () => {
    expect(filterSummary(['宮城県'], 'visited')).toBe('絞り込み：宮城県・訪問済み');
    expect(filterSummary(['青森県'], 'stamp')).toBe('絞り込み：青森県・スタンプ済み');
  });
  it('複数県選択時は+区切りで反映する', () => {
    expect(filterSummary(['青森県', '秋田県'], 'all')).toBe('絞り込み：青森県+秋田県・すべて');
  });
  it('検索文字列も反映する', () => {
    expect(filterSummary(['福島県'], 'none', '猪苗代')).toBe('絞り込み：福島県・未訪問・「猪苗代」');
  });
  it('検索文字列が空/空白のみなら反映しない', () => {
    expect(filterSummary([], 'all', '   ')).toBe('絞り込み：全国・すべて');
  });
  it('設備フィルターを反映する', () => {
    expect(filterSummary([], 'all', '', { rvPark: true, onsen: false })).toBe('絞り込み：全国・すべて・RVパークあり');
    expect(filterSummary([], 'all', '', { rvPark: false, onsen: true })).toBe('絞り込み：全国・すべて・温泉あり');
    expect(filterSummary([], 'all', '', { rvPark: true, onsen: true })).toBe('絞り込み：全国・すべて・RVパーク+温泉あり');
  });
});

describe('matchesSelectedPrefectures（都道府県の複数選択・OR条件）', () => {
  const aomori = { pref: '青森県' } as Station;
  const akita = { pref: '秋田県' } as Station;
  const miyagi = { pref: '宮城県' } as Station;

  it('空配列（全国）はどの駅にも一致する', () => {
    expect(matchesSelectedPrefectures(aomori, [])).toBe(true);
    expect(matchesSelectedPrefectures(miyagi, [])).toBe(true);
  });
  it('単一選択はその県のみ一致する', () => {
    expect(matchesSelectedPrefectures(aomori, ['青森県'])).toBe(true);
    expect(matchesSelectedPrefectures(akita, ['青森県'])).toBe(false);
  });
  it('複数選択はOR（いずれかに該当すれば一致）', () => {
    const selected: Station['pref'][] = ['青森県', '秋田県'];
    expect(matchesSelectedPrefectures(aomori, selected)).toBe(true);
    expect(matchesSelectedPrefectures(akita, selected)).toBe(true);
    expect(matchesSelectedPrefectures(miyagi, selected)).toBe(false);
  });
  it('選択数に上限を設けない（47都道府県すべてを選択しても正しく動作する）', () => {
    const all47 = PREFECTURES as unknown as Station['pref'][];
    expect(all47).toHaveLength(47);
    expect(matchesSelectedPrefectures(aomori, all47)).toBe(true);
    expect(matchesSelectedPrefectures(akita, all47)).toBe(true);
    expect(matchesSelectedPrefectures(miyagi, all47)).toBe(true);
  });
});

describe('prefecturesInArea（地方→都道府県一覧展開）', () => {
  it('東北は6県を返す', () => {
    expect(prefecturesInArea('東北')).toEqual(['青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県']);
  });
  it('北海道は1道のみ', () => {
    expect(prefecturesInArea('北海道')).toEqual(['北海道']);
  });
});

function makeStation(overrides: Partial<Station>): Station {
  return {
    id: 'st-1',
    name: '猪苗代',
    kana: 'いなわしろ',
    pref: '福島県',
    city: '耶麻郡猪苗代町',
    address: '福島県耶麻郡猪苗代町',
    lat: 37.5,
    lng: 140.1,
    status: 'open',
    officialUrl: null,
    infoUrl: 'https://example.com',
    verifiedAt: '2026-01-01',
    sources: [],
    ...overrides,
  };
}

describe('stationMatchesQuery', () => {
  it('空文字はすべてに一致する', () => {
    expect(stationMatchesQuery(makeStation({}), '')).toBe(true);
    expect(stationMatchesQuery(makeStation({}), '   ')).toBe(true);
  });
  it('駅名の部分一致で見つかる', () => {
    expect(stationMatchesQuery(makeStation({ name: '猪苗代' }), '猪苗代')).toBe(true);
    expect(stationMatchesQuery(makeStation({ name: '猪苗代' }), '苗代')).toBe(true);
  });
  it('市町村名の部分一致で見つかる（例: 会津・浪江）', () => {
    expect(stationMatchesQuery(makeStation({ name: 'ばんだい', city: '耶麻郡会津坂下町' }), '会津')).toBe(true);
    expect(stationMatchesQuery(makeStation({ name: 'なみえ', city: '双葉郡浪江町' }), '浪江')).toBe(true);
  });
  it('読み(kana)の部分一致で見つかる', () => {
    expect(stationMatchesQuery(makeStation({ name: '猪苗代', kana: 'いなわしろ' }), 'いなわしろ')).toBe(true);
  });
  it('大文字小文字・全角半角スペースを無視する', () => {
    expect(stationMatchesQuery(makeStation({ name: 'ASAKA' }), 'asaka')).toBe(true);
    expect(stationMatchesQuery(makeStation({ name: '安 積' }), '安積')).toBe(true);
  });
  it('一致しない場合はfalse', () => {
    expect(stationMatchesQuery(makeStation({ name: '猪苗代', city: '耶麻郡猪苗代町', kana: 'いなわしろ' }), '存在しない')).toBe(
      false,
    );
  });
});

describe('matchesFilter（状態フィルター）', () => {
  const st = makeStation({ id: 'st-1' });
  it('all はどの状態でも一致する', () => {
    const visits: VisitMap = {};
    expect(matchesFilter(st, visits, 'all')).toBe(true);
  });
  it('none は未訪問の営業中駅にのみ一致する', () => {
    expect(matchesFilter(st, {}, 'none')).toBe(true);
    expect(matchesFilter(makeStation({ status: 'pre_open' }), {}, 'none')).toBe(false);
  });
  it('want/visited/stamp はそれぞれ対応する状態にのみ一致する', () => {
    const now = new Date().toISOString();
    const wishlist: VisitMap = { 'st-1': { state: 'wishlist', visitedAt: null, wishlistAt: now, stampAt: null, updatedAt: now } };
    const visited: VisitMap = { 'st-1': { state: 'visited', visitedAt: now, wishlistAt: null, stampAt: null, updatedAt: now } };
    const stamped: VisitMap = { 'st-1': { state: 'stamped', visitedAt: now, wishlistAt: null, stampAt: now, updatedAt: now } };
    expect(matchesFilter(st, wishlist, 'want')).toBe(true);
    expect(matchesFilter(st, wishlist, 'visited')).toBe(false);
    expect(matchesFilter(st, visited, 'visited')).toBe(true);
    expect(matchesFilter(st, stamped, 'stamp')).toBe(true);
    expect(matchesFilter(st, stamped, 'visited')).toBe(false);
  });
});

describe('filterStations（地域・状態・テキストの複合絞り込み）', () => {
  const fukushima1 = makeStation({ id: 'f1', name: '猪苗代', pref: '福島県', city: '耶麻郡猪苗代町' });
  const fukushima2 = makeStation({ id: 'f2', name: 'ならは', pref: '福島県', city: '双葉郡楢葉町' });
  const aomori1 = makeStation({ id: 'a1', name: 'しちのへ', pref: '青森県', city: '上北郡七戸町' });
  const stations = [fukushima1, fukushima2, aomori1];

  it('条件なし(空配列=全国)なら全件を返す', () => {
    expect(filterStations(stations, {}, [], 'all', '')).toHaveLength(3);
  });
  it('県フィルターのみ（単一選択）', () => {
    const result = filterStations(stations, {}, ['福島県'], 'all', '');
    expect(result.map((s) => s.id).sort()).toEqual(['f1', 'f2']);
  });
  it('複数県選択はOR結合（青森県+福島県で3件とも該当）', () => {
    const result = filterStations(stations, {}, ['福島県', '青森県'], 'all', '');
    expect(result.map((s) => s.id).sort()).toEqual(['a1', 'f1', 'f2']);
  });
  it('状態フィルターのみ', () => {
    const now = new Date().toISOString();
    const visits: VisitMap = { f1: { state: 'wishlist', visitedAt: null, wishlistAt: now, stampAt: null, updatedAt: now } };
    const result = filterStations(stations, visits, [], 'want', '');
    expect(result.map((s) => s.id)).toEqual(['f1']);
  });
  it('テキスト検索のみ', () => {
    const result = filterStations(stations, {}, [], 'all', '猪苗代');
    expect(result.map((s) => s.id)).toEqual(['f1']);
  });
  it('複合条件（複数県+状態+テキスト）はすべてAND結合される', () => {
    const now = new Date().toISOString();
    const visits: VisitMap = {
      f1: { state: 'wishlist', visitedAt: null, wishlistAt: now, stampAt: null, updatedAt: now },
      f2: { state: 'wishlist', visitedAt: null, wishlistAt: now, stampAt: null, updatedAt: now },
    };
    // 福島県+青森県・行きたい・「なら」で絞ると f2(ならは) だけが残る
    // （f1は県/状態は一致するがテキスト不一致、a1はそもそも行きたいではない）
    const result = filterStations(stations, visits, ['福島県', '青森県'], 'want', 'なら');
    expect(result.map((s) => s.id)).toEqual(['f2']);
  });
  it('一致しない組み合わせは空配列', () => {
    expect(filterStations(stations, {}, ['青森県'], 'visited', '')).toEqual([]);
  });
});

describe('matchesFacilityFilter（道の駅自体の設備条件フィルター）', () => {
  const both = makeStation({ facilities: { rvPark: 'yes', onsen: 'yes' } });
  const onlyOnsen = makeStation({ facilities: { rvPark: 'no', onsen: 'yes' } });
  const onlyRvPark = makeStation({ facilities: { rvPark: 'yes', onsen: 'no' } });
  const neither = makeStation({ facilities: { rvPark: 'no', onsen: 'no' } });
  const unknown = makeStation({ facilities: undefined });

  it('フィルター未使用（両方false）は常にtrue', () => {
    expect(matchesFacilityFilter(neither, { rvPark: false, onsen: false })).toBe(true);
    expect(matchesFacilityFilter(unknown, { rvPark: false, onsen: false })).toBe(true);
  });
  it('RVパークのみ選択: rvPark=yesの駅だけ一致', () => {
    expect(matchesFacilityFilter(onlyRvPark, { rvPark: true, onsen: false })).toBe(true);
    expect(matchesFacilityFilter(onlyOnsen, { rvPark: true, onsen: false })).toBe(false);
  });
  it('温泉のみ選択: onsen=yesの駅だけ一致', () => {
    expect(matchesFacilityFilter(onlyOnsen, { rvPark: false, onsen: true })).toBe(true);
    expect(matchesFacilityFilter(onlyRvPark, { rvPark: false, onsen: true })).toBe(false);
  });
  it('両方選択時はAND（両方yesの駅のみ一致、片方だけは不一致）', () => {
    expect(matchesFacilityFilter(both, { rvPark: true, onsen: true })).toBe(true);
    expect(matchesFacilityFilter(onlyOnsen, { rvPark: true, onsen: true })).toBe(false);
    expect(matchesFacilityFilter(onlyRvPark, { rvPark: true, onsen: true })).toBe(false);
    expect(matchesFacilityFilter(neither, { rvPark: true, onsen: true })).toBe(false);
  });
  it('unknown（facilities未収録）は「ある」とみなさない', () => {
    expect(matchesFacilityFilter(unknown, { rvPark: true, onsen: false })).toBe(false);
    expect(matchesFacilityFilter(unknown, { rvPark: false, onsen: true })).toBe(false);
  });
});

describe('filterStations（設備条件との複合）', () => {
  const withOnsen = makeStation({ id: 'o1', pref: '福島県', facilities: { rvPark: 'no', onsen: 'yes' } });
  const withRvPark = makeStation({ id: 'r1', pref: '福島県', facilities: { rvPark: 'yes', onsen: 'no' } });
  const withBoth = makeStation({ id: 'b1', pref: '宮城県', facilities: { rvPark: 'yes', onsen: 'yes' } });
  const withNeither = makeStation({ id: 'n1', pref: '宮城県', facilities: { rvPark: 'no', onsen: 'no' } });
  const stations = [withOnsen, withRvPark, withBoth, withNeither];

  it('温泉ありのみで絞る', () => {
    const result = filterStations(stations, {}, [], 'all', '', { rvPark: false, onsen: true });
    expect(result.map((s) => s.id).sort()).toEqual(['b1', 'o1']);
  });
  it('RVパーク+温泉の複合（AND）で絞る', () => {
    const result = filterStations(stations, {}, [], 'all', '', { rvPark: true, onsen: true });
    expect(result.map((s) => s.id)).toEqual(['b1']);
  });
  it('県フィルター（単一）と設備フィルターのAND', () => {
    const result = filterStations(stations, {}, ['宮城県'], 'all', '', { rvPark: true, onsen: true });
    expect(result.map((s) => s.id)).toEqual(['b1']);
    expect(filterStations(stations, {}, ['福島県'], 'all', '', { rvPark: true, onsen: true })).toEqual([]);
  });
  it('複数県選択（OR）と設備フィルター（AND）を組み合わせても正しい', () => {
    // 福島県+宮城県のOR AND RVパーク+温泉AND → b1のみ（宮城県かつ両方あり）
    const result = filterStations(stations, {}, ['福島県', '宮城県'], 'all', '', { rvPark: true, onsen: true });
    expect(result.map((s) => s.id)).toEqual(['b1']);
  });
});
