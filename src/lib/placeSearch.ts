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

/**
 * 施設種別を表す一般的な語尾。名称の「核」を取り出して比較するために落とす
 * （「郡山IC」と「郡山インター」を同じ核『郡山』として扱う）。
 */
const FACILITY_SUFFIX = /(ic|jct|pa|sa|インターチェンジ|インター|ジャンクション|駅|停留所)$/i;

/** 比較用の名称の核（施設語尾を除いたもの） */
function coreName(s: string): string {
  return normalize(s).replace(FACILITY_SUFFIX, '');
}

/** 2つの文字列が共有する最長の連続部分列の長さ */
function longestCommonSubstring(a: string, b: string): number {
  if (!a || !b) return 0;
  let best = 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) best = cur[j];
      }
    }
    prev = cur;
  }
  return best;
}

export type NameMatchLevel = 'exact' | 'contains' | 'partial' | 'none';

/**
 * 検索語と候補名称の一致度。施設種別が合っているだけで無関係な施設を上位に出さないため、
 * 並べ替えでも絞り込みでもこの値を主軸にする。
 * 例: 「郡山中央IC」に対して「賀陽IC」は none（核『郡山中央』と『賀陽』に共通部分がない）。
 */
export function nameMatchLevel(query: string, name: string): NameMatchLevel {
  const q = coreName(query);
  const n = coreName(name);
  if (!q || !n) return 'none';
  if (q === n) return 'exact';
  const shorter = Math.min(q.length, n.length);
  if ((q.includes(n) || n.includes(q)) && shorter >= 2) return 'contains';
  return longestCommonSubstring(q, n) >= 2 ? 'partial' : 'none';
}

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

  const merged = dedupeCandidates([...stationHits, ...osmHits, ...gsiHits]);
  const candidates = rankCandidates(dropUnrelated(merged, q, context), q, context).slice(0, MAX_RESULTS);
  return {
    candidates,
    geocodeFailed: osmSettled.status === 'rejected' && gsiSettled.status === 'rejected',
    usedOsm: candidates.some((c) => c.source === 'osm'),
  };
}

/**
 * 重複候補をまとめる。
 * 1. ほぼ同じ座標（約10m）… 別々の情報源が同じ地点を返した場合
 * 2. 同じ名称・同じ都道府県・同じ市区町村 … ICの出入口など、1つの施設が
 *    複数ノードとして登録されている場合（実機で福島県郡山市の郡山ICが2件出た）
 * 名称が違うものは別施設として残す（誤って統合しない）。
 */
export function dedupeCandidates(candidates: PlaceCandidate[]): PlaceCandidate[] {
  const points: { lat: number; lng: number }[] = [];
  const keys = new Set<string>();
  const out: PlaceCandidate[] = [];
  for (const c of candidates) {
    if (points.some((p) => Math.abs(p.lat - c.lat) < 1e-4 && Math.abs(p.lng - c.lng) < 1e-4)) continue;
    const key = `${normalize(c.label)}|${c.prefecture ?? ''}|${c.sub ?? ''}`;
    if (keys.has(key)) continue;
    points.push({ lat: c.lat, lng: c.lng });
    keys.add(key);
    out.push(c);
  }
  return out;
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

  const NAME_SCORE: Record<NameMatchLevel, number> = { exact: 60, contains: 35, partial: 12, none: 0 };

  const score = (c: PlaceCandidate): number => {
    let n = NAME_SCORE[nameMatchLevel(query, c.label)];
    // 完全一致していなくても、入力語そのものを含む名称は拾う（「郡山インター線」等）
    if (normalize(c.label).includes(q) && n < 35) n += 10;

    if (hint) {
      if (c.osmType && hint.types.includes(c.osmType)) n += 40;
      else if (c.osmCategory === hint.category) n += 20;
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

/**
 * 明らかに無関係な候補を落とす。
 * 「名称もあまり合っておらず、いま見ている県でもない」ものは出さない
 * （実機で「郡山中央インター」に岡山県の賀陽IC・勝央ICが出た件）。
 * 名称がはっきり一致していれば県外でも残す（福島県表示中の「秋田駅」など）。
 * 表示県が決まっていない（全国）ときは判断材料が無いので落とさない。
 */
export function dropUnrelated(
  candidates: PlaceCandidate[],
  query: string,
  context?: PlaceSearchContext,
): PlaceCandidate[] {
  const prefs = context?.prefectures ?? [];
  if (prefs.length === 0) return candidates;
  return candidates.filter((c) => {
    const level = nameMatchLevel(query, c.label);
    if (level === 'exact' || level === 'contains') return true;
    return c.prefecture != null && prefs.includes(c.prefecture as Prefecture);
  });
}
