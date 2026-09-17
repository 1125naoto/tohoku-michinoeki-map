/**
 * 出発地点・経由地・最終目的地で共通に使う「名称・住所から探す」検索。
 *
 * 3つの無料・APIキー不要の情報源を組み合わせる（有料APIは使わない）:
 * 1. アプリ内の道の駅データ（通信なし・即時）
 * 2. OpenStreetMap Nominatim（lib/nominatim.ts）… IC・駅・ホテル・観光施設などの施設名
 * 3. 国土地理院 住所検索API（lib/geocode.ts）… 住所・地名
 *
 * 実応答で確認した役割分担:
 * - 「郡山IC」「郡山駅」「鶴ヶ城」「ホテルメトロポリタン秋田」… Nominatimが該当施設を返す。
 *   国土地理院側は“IC/駅”が無視され無関係な大字「郡山」を返すため、施設名はNominatimに任せる
 * - 「福島県郡山市安積町」のような住所 … 国土地理院が正確
 *
 * 候補は勝手に1件へ決め打ちせず、一覧で返して利用者に選んでもらう。
 */
import { geocode } from './geocode';
import { searchPlacesByName } from './nominatim';
import type { Prefecture, Station } from '../types';
import { PREFECTURES } from '../types';

/** OSMの種別 → 画面に出す日本語（返ってこない情報は作らない） */
const OSM_TYPE_LABEL: Record<string, string> = {
  motorway_junction: 'インターチェンジ',
  station: '駅',
  train_station: '駅',
  halt: '駅',
  tram_stop: '停留所',
  hotel: 'ホテル',
  guest_house: '宿',
  motel: 'モーテル',
  museum: '博物館・美術館',
  attraction: '観光スポット',
  castle: '城',
};

export interface PlaceCandidate {
  /** Reactのkey・data-testid用 */
  id: string;
  /** 候補の主表示（施設名・地名） */
  label: string;
  /** 補足表示（所在地: 県＋市区町村など）。無ければnull */
  sub: string | null;
  /** 施設の内訳表示（路線名・種別。例「東北自動車道・インターチェンジ」）。無ければnull */
  detail: string | null;
  lat: number;
  lng: number;
  /**
   * 'station'=アプリ内の道の駅データ / 'osm'=OpenStreetMap Nominatim（施設名）/
   * 'gsi'=国土地理院 住所検索
   */
  source: 'station' | 'osm' | 'gsi';
  /** 都道府県（分かる場合のみ）。並べ替えの文脈一致に使う */
  prefecture: string | null;
  /** OSMの大分類・種別（分かる場合のみ）。並べ替えの種別一致に使う */
  osmCategory: string | null;
  osmType: string | null;
}

/** 検索の文脈。いま地図で見ている都道府県を優先順位づけにだけ使う（絞り込みはしない） */
export interface PlaceSearchContext {
  prefectures: Prefecture[];
}

export interface PlaceSearchResult {
  candidates: PlaceCandidate[];
  /** 外部検索（施設名・住所）がどちらも失敗したか（道の駅の結果だけは返せている場合がある） */
  geocodeFailed: boolean;
  /** OpenStreetMap由来の候補を含むか（出典表示の要否） */
  usedOsm: boolean;
}

const MAX_STATION_HITS = 5;
/** 画面に出す候補の上限 */
const MAX_RESULTS = 5;

/** 入力から読み取れる施設種別のヒント（OSMのcategory/typeと突き合わせる） */
function facilityHint(query: string): { category: string; types: string[] } | null {
  if (/(IC|インターチェンジ|インター(?!ネット))/i.test(query)) {
    return { category: 'highway', types: ['motorway_junction'] };
  }
  if (/(JCT|ジャンクション)/i.test(query)) return { category: 'highway', types: ['motorway_junction'] };
  if (/駅$|駅[\s　]|^.+駅/.test(query)) {
    return { category: 'railway', types: ['station', 'train_station', 'halt', 'tram_stop'] };
  }
  if (/(ホテル|旅館|イン$)/.test(query)) return { category: 'tourism', types: ['hotel', 'guest_house', 'motel'] };
  if (/(城|寺|神社|公園|美術館|博物館)/.test(query)) return { category: 'tourism', types: ['attraction', 'museum'] };
  return null;
}

/** 全角スペース・記号ゆれを吸収した比較用のキー */
function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/[\s　]+/g, '');
}

/** アプリ内の道の駅データから名称・読み・市区町村で照合する（通信なし・即時） */
export function searchStations(query: string, stations: Station[]): PlaceCandidate[] {
  const q = normalize(query);
  if (!q) return [];
  // 「道の駅〇〇」と入力された場合も拾えるよう、接頭辞を落としたキーでも照合する
  const qWithoutPrefix = q.startsWith('道の駅') ? q.slice('道の駅'.length) : q;
  const hits: PlaceCandidate[] = [];
  for (const st of stations) {
    if (st.status !== 'open') continue;
    const haystacks = [normalize(st.name), normalize(st.kana ?? ''), normalize(st.city)];
    if (!haystacks.some((h) => h && (h.includes(qWithoutPrefix) || h.includes(q)))) continue;
    hits.push({
      id: `station:${st.id}`,
      label: `道の駅${st.name}`,
      sub: `${st.pref}${st.city}`,
      detail: '道の駅',
      lat: st.lat,
      lng: st.lng,
      source: 'station',
      prefecture: st.pref,
      osmCategory: null,
      osmType: null,
    });
    if (hits.length >= MAX_STATION_HITS) break;
  }
  return hits;
}

/**
 * 名称・住所での地点検索。道の駅（ローカル）→ 住所検索（国土地理院）の順に並べる。
 * 同名の候補を勝手に1件へ決め打ちせず、候補一覧をそのまま返す。
 */
export async function searchPlaces(
  query: string,
  stations: Station[],
  context?: PlaceSearchContext,
): Promise<PlaceSearchResult> {
  const q = query.trim();
  if (!q) return { candidates: [], geocodeFailed: false, usedOsm: false };

  const stationHits = searchStations(q, stations);

  // 施設名（IC・駅・ホテル・観光施設）はNominatim、住所・地名は国土地理院が得意なので
  // 両方に投げて、施設 → 住所の順に並べる。片方が落ちてももう片方の候補は出す。
  const [osmSettled, gsiSettled] = await Promise.allSettled([searchPlacesByName(q), geocode(q)]);

  const osmHits: PlaceCandidate[] =
    osmSettled.status === 'fulfilled'
      ? osmSettled.value.map((r, i) => ({
          id: `osm:${i}:${r.lat},${r.lng}`,
          label: r.name,
          sub: [r.prefecture, r.city].filter(Boolean).join('') || r.address,
          detail: [r.road, OSM_TYPE_LABEL[r.kind ?? ''] ?? null].filter(Boolean).join('・') || null,
          lat: r.lat,
          lng: r.lng,
          source: 'osm' as const,
          prefecture: r.prefecture,
          osmCategory: r.category,
          osmType: r.kind,
        }))
      : [];
  const gsiHits: PlaceCandidate[] =
    gsiSettled.status === 'fulfilled'
      ? gsiSettled.value.map((r, i) => ({
          id: `gsi:${i}:${r.lat},${r.lng}`,
          label: r.label,
          sub: null,
          detail: null,
          lat: r.lat,
          lng: r.lng,
          source: 'gsi' as const,
          prefecture: PREFECTURES.find((p) => r.label.startsWith(p)) ?? null,
          osmCategory: null,
          osmType: null,
        }))
      : [];

  // 同じ地点が両方から返ることがあるため、座標の近さで重複を落とす（約10m）
  const seen: { lat: number; lng: number }[] = [];
  const isNew = (c: PlaceCandidate) => {
    if (seen.some((p) => Math.abs(p.lat - c.lat) < 1e-4 && Math.abs(p.lng - c.lng) < 1e-4)) return false;
    seen.push({ lat: c.lat, lng: c.lng });
    return true;
  };

  const merged = [...stationHits, ...osmHits, ...gsiHits].filter(isNew);
  const candidates = rankCandidates(merged, q, context).slice(0, MAX_RESULTS);
  return {
    candidates,
    geocodeFailed: osmSettled.status === 'rejected' && gsiSettled.status === 'rejected',
    usedOsm: candidates.some((c) => c.source === 'osm'),
  };
}

/**
 * 候補の並べ替え。日本のドライブ用途で自然な順になるよう、次を組み合わせて加点する。
 * 県一致だけで決めない（「秋田駅」を福島県表示中に探しても出せるようにするため）。
 *  1. 検索語と名称の一致（完全一致 > 前方一致 > 部分一致）
 *  2. 施設種別の一致（「◯◯駅」なら鉄道駅、「◯◯IC」なら高速のIC）
 *  3. いま表示中の都道府県と一致
 *  4. 地名より実在施設（OSM）を優先
 */
export function rankCandidates(
  candidates: PlaceCandidate[],
  query: string,
  context?: PlaceSearchContext,
): PlaceCandidate[] {
  const q = normalize(query);
  const hint = facilityHint(query);
  const prefs = context?.prefectures ?? [];

  const score = (c: PlaceCandidate): number => {
    let n = 0;
    const name = normalize(c.label);
    if (name === q) n += 50;
    else if (name.startsWith(q) || q.startsWith(name)) n += 30;
    else if (name.includes(q)) n += 15;

    if (hint) {
      if (c.osmType && hint.types.includes(c.osmType)) n += 40;
      else if (c.osmCategory === hint.category) n += 25;
      else if (c.source === 'gsi') n -= 15; // 施設を探しているのに地名だけが返っている
    }

    if (prefs.length > 0 && c.prefecture && prefs.includes(c.prefecture as Prefecture)) n += 20;
    if (c.source === 'station') n += 12;
    else if (c.source === 'osm') n += 8;
    return n;
  };

  return candidates
    .map((c, i) => ({ c, i, s: score(c) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.c);
}
