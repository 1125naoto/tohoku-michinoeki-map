import { describe, expect, it } from 'vitest';
import { googleWebSearchUrl, stationNearbySearchQuery, WEB_SEARCH_CATEGORY_LABEL } from './websearch';
import { stationSearchUrl } from './gmaps';
import { STATIONS } from '../data';

/**
 * 外部探索の役割分離（Fable 5.1 Root Cause Audit再監査の最終形）の回帰テスト。
 * Google Web検索＝カテゴリごとの詳細探索、Google Maps＝道の駅そのものを開く専用、
 * という分離が崩れていないことを確認する。
 */
describe('Google Web検索（周辺スポットパネルの「もっと探す」CTA）', () => {
  const aizu = STATIONS.find((s) => s.id === 'mne-19042')!; // あいづ 湯川・会津坂下
  const tamakawa = STATIONS.find((s) => s.id === 'mne-19029')!; // たまかわ
  const fukushima = STATIONS.find((s) => s.id === 'mne-19971')!; // ふくしま

  it('CASE1: 道の駅あいづ 湯川・会津坂下 + 宿泊 → クエリに駅名・周辺・ホテル・旅館を含み、住所も緯度経度も含まない', () => {
    const q = stationNearbySearchQuery(aizu, 'lodging');
    expect(q).toContain(`道の駅${aizu.name}`);
    expect(q).toContain('周辺');
    expect(q).toContain('ホテル');
    expect(q).toContain('旅館');
    expect(q).not.toContain(aizu.address);
    expect(q).not.toMatch(/\d{1,3}\.\d{4,},\d{1,3}\.\d{4,}/);
  });

  it('CASE2: たまかわ + 食べる → 「周辺 飲食店」', () => {
    const q = stationNearbySearchQuery(tamakawa, 'food');
    expect(q).toBe(`道の駅${tamakawa.name} 周辺 飲食店`);
  });

  it('CASE3: ふくしま + 観光 → 「周辺 観光スポット」', () => {
    const q = stationNearbySearchQuery(fukushima, 'tourism');
    expect(q).toBe(`道の駅${fukushima.name} 周辺 観光スポット`);
  });

  it('CASE4: 温泉・休憩 → 「周辺 温泉」', () => {
    const q = stationNearbySearchQuery(tamakawa, 'onsen');
    expect(q).toBe(`道の駅${tamakawa.name} 周辺 温泉`);
  });

  it('すべて（カテゴリ未選択） → 「周辺 観光 グルメ 温泉 宿泊」', () => {
    const q = stationNearbySearchQuery(tamakawa, null);
    expect(q).toBe(`道の駅${tamakawa.name} 周辺 観光 グルメ 温泉 宿泊`);
  });

  it('CASE5: Web検索URLはhttps://www.google.com/search?q=形式である', () => {
    const url = googleWebSearchUrl(stationNearbySearchQuery(tamakawa, 'food'));
    expect(url.startsWith('https://www.google.com/search?q=')).toBe(true);
    const dec = decodeURIComponent(url.slice('https://www.google.com/search?q='.length));
    expect(dec).toBe(`道の駅${tamakawa.name} 周辺 飲食店`);
  });

  it('CASE6: Google Maps URL（既存stationSearchUrl）はカテゴリ語を含まず、Web検索の設計変更後も従来どおり', () => {
    const url = stationSearchUrl(tamakawa);
    const dec = decodeURIComponent(url);
    expect(dec).toContain(`道の駅${tamakawa.name}`);
    expect(dec).toContain(tamakawa.address);
    for (const keyword of ['飲食店', '観光スポット', '温泉', 'ホテル', '旅館']) {
      expect(dec).not.toContain(keyword);
    }
  });

  it('CASE7: Google Places API等の有料APIキーを含まない', () => {
    const url = googleWebSearchUrl(stationNearbySearchQuery(tamakawa, 'lodging'));
    expect(url).not.toContain('key=');
    expect(url).not.toContain('places');
    expect(url).not.toContain('maps.googleapis.com');
  });

  it('駅名に既に「道の駅」が含まれる場合、「道の駅道の駅」に重複しない', () => {
    const kitagou = STATIONS.find((s) => s.id === 'mne-22061')!; // 道の駅きたごう
    expect(kitagou.name.startsWith('道の駅')).toBe(true);
    const q = stationNearbySearchQuery(kitagou, 'food');
    expect(q.startsWith(kitagou.name)).toBe(true);
    expect(q).not.toContain('道の駅道の駅');
  });

  it('WEB_SEARCH_CATEGORY_LABEL: CTA表示文言用のカテゴリ語が全カテゴリぶん揃っている', () => {
    expect(WEB_SEARCH_CATEGORY_LABEL.food).toBe('周辺の飲食店');
    expect(WEB_SEARCH_CATEGORY_LABEL.tourism).toBe('周辺の観光スポット');
    expect(WEB_SEARCH_CATEGORY_LABEL.onsen).toBe('周辺の温泉');
    expect(WEB_SEARCH_CATEGORY_LABEL.lodging).toBe('周辺のホテル・旅館');
  });
});
