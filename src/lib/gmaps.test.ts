import { describe, expect, it } from 'vitest';
import {
  avoidParam,
  categoryDetailSearchUrl,
  directionsSegments,
  directionsUrls,
  MAX_WAYPOINTS,
  navToPointUrl,
  navToStationUrl,
  stationSearchUrl,
} from './gmaps';
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

  describe('categoryDetailSearchUrl（公開前UX整理: 「Googleマップでもっと探す」CTA）', () => {
    it('公式仕様(/maps/search/?api=1&query=)のURLを生成し、検索語と検索地点の座標を含む', () => {
      const url = categoryDetailSearchUrl('飲食店', { lat: 37.4004, lng: 140.3597 });
      expect(url).toContain('https://www.google.com/maps/search/?api=1&query=');
      const dec = decodeURIComponent(url);
      expect(dec).toContain('飲食店');
      expect(dec).toContain('37.400400');
      expect(dec).toContain('140.359700');
    });

    it('Google Places API等の有料APIキーを含まない（クエリのみのURL）', () => {
      const url = categoryDetailSearchUrl('観光スポット', { lat: 37.4, lng: 140.36 });
      expect(url).not.toContain('key=');
      expect(url).not.toContain('places');
    });
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

  it('経由地の実用上限はモバイル実機で確認済みの3件（Astra P1: 公式API上限(9)のままだとモバイルアプリで経由地が無視される）', () => {
    // この値を安易に9へ戻さないための回帰ガード。実機確認の結果である旨はgmaps.tsのコメント参照。
    expect(MAX_WAYPOINTS).toBe(3);
  });

  it('20地点の混在ルート(道の駅+周辺スポット相当)でも、全区間が連結し全地点が経路に含まれる', () => {
    const pts = Array.from({ length: 20 }, (_, i) => ({ lat: 37 + i * 0.05, lng: 140 + i * 0.05 }));
    const urls = directionsUrls(pts);
    expect(urls.length).toBeGreaterThan(1);
    // 復元: 各区間のorigin→waypoints→destinationを連結すると元の点列に一致する
    const rebuilt: string[] = [];
    for (const url of urls) {
      const dec = decodeURIComponent(url);
      const origin = /origin=([^&]*)/.exec(dec)![1];
      const destination = /destination=([^&]*)/.exec(dec)![1];
      const wpMatch = /waypoints=([^&]*)/.exec(dec);
      const waypoints = wpMatch ? wpMatch[1].split('|') : [];
      if (rebuilt.length === 0) rebuilt.push(origin);
      rebuilt.push(...waypoints, destination);
    }
    const expected = pts.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`);
    expect(rebuilt).toEqual(expected);
  });

  it('地点が1つ以下ならURLを生成しない', () => {
    expect(directionsUrls([])).toEqual([]);
    expect(directionsUrls([{ lat: 37, lng: 140 }])).toEqual([]);
  });

  describe('実機不具合の回帰: 経由地(waypoints)の区切り文字が二重エンコードされていた', () => {
    // Owner実機QA: 区間1/2（経由地ありの区間）だけ住所は表示されるがその先
    // 反応しない不具合。Google公式ドキュメントの例（waypoints=A|B|C）は区切りの
    // 「|」を生のまま使う。以前は地点列全体を1つの文字列に結合してから
    // encodeURIComponentしており「|」が「%7C」になっていた。
    it('生のURLで、経由地の区切りは literal な「|」であり「%7C」にはならない', () => {
      const pts = [
        { lat: 37.0, lng: 140.0 },
        { lat: 37.1, lng: 140.1 },
        { lat: 37.2, lng: 140.2 },
        { lat: 37.3, lng: 140.3 },
        { lat: 37.4, lng: 140.4 },
      ];
      const [url] = directionsUrls(pts);
      const waypointsRaw = /waypoints=([^&]*)/.exec(url)![1];
      expect(waypointsRaw).not.toContain('%7C');
      expect(waypointsRaw).not.toContain('%7c');
      expect(waypointsRaw.split('|').length).toBe(3);
      // 各座標自体（カンマ）は個別にencodeURIComponentされていること
      expect(waypointsRaw).toContain('%2C');
    });
  });

  describe('directionsSegments: 区間ごとの説明ラベル（Googleマップ分割ナビのUX改善）', () => {
    it('地点にlabelがあれば、各区間のfromLabel/toLabelに反映される', () => {
      const pts = [
        { lat: 37.0, lng: 140.0, label: '出発地点' },
        { lat: 37.1, lng: 140.1, label: '道の駅A' },
        { lat: 37.2, lng: 140.2, label: '道の駅B' },
      ];
      const segments = directionsSegments(pts);
      expect(segments.length).toBe(1);
      expect(segments[0].fromLabel).toBe('出発地点');
      expect(segments[0].toLabel).toBe('道の駅B');
      expect(segments[0].index).toBe(1);
      expect(segments[0].total).toBe(1);
    });

    it('区間分割時、各区間のfromLabel/toLabelが連結する（前区間のtoLabel=次区間のfromLabel）', () => {
      const pts = Array.from({ length: 8 }, (_, i) => ({
        lat: 37 + i * 0.1,
        lng: 140 + i * 0.1,
        label: `地点${i}`,
      }));
      const segments = directionsSegments(pts);
      expect(segments.length).toBeGreaterThan(1);
      for (let i = 0; i < segments.length - 1; i++) {
        expect(segments[i].toLabel).toBe(segments[i + 1].fromLabel);
      }
    });

    it('地点にqueryがあれば、生の座標ではなくqueryをGoogleマップへ渡す（駐車場等の誤ラベル対策）', () => {
      const st = STATIONS[0];
      const pts = [
        { lat: 37.0, lng: 140.0 },
        { lat: st.lat, lng: st.lng, label: `道の駅 ${st.name}`, query: `道の駅${st.name} ${st.address}` },
      ];
      const [url] = directionsUrls(pts);
      const dec = decodeURIComponent(url);
      expect(dec).toContain(`destination=道の駅${st.name} ${st.address}`);
      expect(dec).not.toContain(`destination=${st.lat.toFixed(6)}`);
    });
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

  it('道路の希望はGoogleマップURLのavoidに反映される（一般道を優先は高速+有料の両方を回避）', () => {
    expect(avoidParam('highway_ok')).toBeNull(); // おまかせ・早いルート
    expect(avoidParam('no_tolls')).toBe('tolls'); // 有料道路を使わない
    expect(avoidParam('no_highway')).toBe('highways,tolls'); // 一般道を優先
    expect(navToStationUrl(STATIONS[0], 'no_highway')).toContain('avoid=highways,tolls');
    expect(navToStationUrl(STATIONS[0], 'no_tolls')).toContain('avoid=tolls');
    expect(navToStationUrl(STATIONS[0], 'highway_ok')).not.toContain('avoid=');
    const dirs = directionsUrls(
      [
        { lat: 37, lng: 140 },
        { lat: 37.1, lng: 140.1 },
      ],
      'no_highway',
    );
    expect(decodeURIComponent(dirs[0])).toContain('avoid=highways,tolls');
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
