import { describe, expect, it } from 'vitest';
import { avoidParam, directionsUrls, MAX_WAYPOINTS, navToPointUrl, navToStationUrl, stationSearchUrl } from './gmaps';
import { STATIONS } from '../data';
import { computeStats } from './stats';
import type { VisitMap } from '../types';

describe('Googleマップ連携', () => {
  it('施設URLは名称と住所を含む検索URL', () => {
    const st = STATIONS[0];
    const url = stationSearchUrl(st);
    const dec = decodeURIComponent(url);
    expect(dec).toContain(st.name);
    expect(dec).toContain(st.address);
  });

  it('経路URLの経由順が正しい', () => {
    const pts = [
      { lat: 37.0, lng: 140.0 },
      { lat: 37.1, lng: 140.1 },
      { lat: 37.2, lng: 140.2 },
      { lat: 37.0, lng: 140.0 },
    ];
    const urls = directionsUrls(pts);
    expect(urls.length).toBe(1);
    const u = decodeURIComponent(urls[0]);
    expect(u).toContain('origin=37.000000,140.000000');
    expect(u).toContain('destination=37.000000,140.000000');
    expect(u).toContain('waypoints=37.100000,140.100000|37.200000,140.200000');
    // origin → waypoints → destination の順で出現
    expect(u.indexOf('origin=')).toBeLessThan(u.indexOf('destination='));
  });

  it('経由地点が上限を超えたら複数区間へ分割し、区間が連結している', () => {
    const pts = Array.from({ length: 25 }, (_, i) => ({ lat: 37 + i * 0.1, lng: 140 + i * 0.1 }));
    const urls = directionsUrls(pts);
    expect(urls.length).toBeGreaterThan(1);
    // 各URLのwaypoints数が上限以下
    for (const url of urls) {
      const m = /waypoints=([^&]*)/.exec(url);
      if (m) {
        expect(decodeURIComponent(m[1]).split('|').length).toBeLessThanOrEqual(MAX_WAYPOINTS);
      }
    }
    // 前区間のdestination = 次区間のorigin
    for (let i = 0; i < urls.length - 1; i++) {
      const dest = /destination=([^&]*)/.exec(urls[i])![1];
      const nextOrigin = /origin=([^&]*)/.exec(urls[i + 1])![1];
      expect(dest).toBe(nextOrigin);
    }
  });

  it('地点が1つ以下ならURLを生成しない', () => {
    expect(directionsUrls([])).toEqual([]);
    expect(directionsUrls([{ lat: 37, lng: 140 }])).toEqual([]);
  });

  it('次の駅へのナビURLは現在地→施設名+住所で、ナビ直行パラメータを含む', () => {
    const st = STATIONS[0];
    const url = navToStationUrl(st);
    const dec = decodeURIComponent(url);
    expect(url).toContain('https://www.google.com/maps/dir/?api=1');
    expect(url).not.toContain('origin='); // origin省略=現在地から
    expect(dec).toContain(`道の駅${st.name}`);
    expect(dec).toContain(st.address);
    expect(url).toContain('travelmode=driving');
    expect(url).toContain('dir_action=navigate');
  });

  it('道路条件はGoogleマップURLのavoidに反映される', () => {
    expect(avoidParam('highway_ok')).toBeNull();
    expect(avoidParam('no_highway')).toBe('highways');
    expect(avoidParam('no_tolls')).toBe('tolls');
    expect(navToStationUrl(STATIONS[0], 'no_highway')).toContain('avoid=highways');
    expect(navToStationUrl(STATIONS[0], 'no_tolls')).toContain('avoid=tolls');
    expect(navToStationUrl(STATIONS[0], 'highway_ok')).not.toContain('avoid=');
    const dirs = directionsUrls(
      [
        { lat: 37, lng: 140 },
        { lat: 37.1, lng: 140.1 },
      ],
      'no_highway',
    );
    expect(dirs[0]).toContain('avoid=highways');
  });

  it('帰路ナビURLは現在地→出発地点座標', () => {
    const url = navToPointUrl({ lat: 37.4004, lng: 140.3597 }, 'no_tolls');
    expect(url).toContain('destination=37.400400,140.359700');
    expect(url).toContain('dir_action=navigate');
    expect(url).toContain('avoid=tolls');
  });
});

describe('達成率の集計', () => {
  it('分母は収録データから自動計算される', () => {
    const s = computeStats(STATIONS, {});
    expect(s.total).toBe(STATIONS.length);
    expect(s.visited).toBe(0);
    expect(s.percent).toBe(0);
    const sumPref = s.byPref.reduce((a, p) => a + p.total, 0);
    expect(sumPref).toBe(STATIONS.length);
  });

  it('訪問・スタンプ数と達成率が更新される', () => {
    const visits: VisitMap = {};
    const targets = STATIONS.slice(0, 42);
    for (const st of targets) {
      visits[st.id] = {
        state: st.id === targets[0].id ? 'stamped' : 'visited',
        visitedAt: '2026-09-01T00:00:00Z',
        wishlistAt: null,
        stampAt: st.id === targets[0].id ? '2026-09-01T00:00:00Z' : null,
        updatedAt: '2026-09-01T00:00:00Z',
      };
    }
    const s = computeStats(STATIONS, visits);
    expect(s.visited).toBe(42);
    expect(s.stamped).toBe(1);
    expect(s.percent).toBe(Math.round((42 / STATIONS.length) * 100));
  });

  it('達成率100%も正しく計算される', () => {
    const visits: VisitMap = {};
    for (const st of STATIONS) {
      visits[st.id] = {
        state: 'stamped',
        visitedAt: '2026-09-01T00:00:00Z',
        wishlistAt: null,
        stampAt: '2026-09-01T00:00:00Z',
        updatedAt: '2026-09-01T00:00:00Z',
      };
    }
    const s = computeStats(STATIONS, visits);
    expect(s.percent).toBe(100);
    expect(s.visited).toBe(s.total);
  });
});
