/**
 * 出発地点などの「名称・住所から探す」検索。
 *
 * 外部サービスは既存の国土地理院 住所検索API（lib/geocode.ts・無料・APIキー不要）
 * だけを使い、新しい有料API（Google Places等）やAPIキーは追加しない。
 *
 * 実際の応答を確認した上での、このAPIの守備範囲（推測ではなく実測）:
 * - 住所（都道府県・市区町村・大字）        … 例「福島県郡山市安積町」→ ヒット
 * - 一部の施設的な地名（○○市役所・○○公園）… 例「鶴ヶ城」→「鶴ヶ城公園」
 * - 施設名そのもの（IC・駅・ホテル等）      … 非対応。
 *   「郡山インター」「郡山IC」「郡山駅」は“インター/IC/駅”が無視され、
 *   無関係な大字「郡山」（宮城・秋田・山形）が返る。「ホテルハマツ」は0件。
 *
 * そのため、アプリが自前で持っているデータ（全国の道の駅）はローカルで先に照合し、
 * 足りない部分は住所検索へ委ねる。どちらも当たらない場合は、何なら探せるのかを
 * 画面側で案内する（存在しない検索能力があるかのように見せない）。
 */
import { geocode } from './geocode';
import type { Station } from '../types';

export interface PlaceCandidate {
  /** Reactのkey・data-testid用 */
  id: string;
  /** 候補の主表示（施設名・地名） */
  label: string;
  /** 補足表示（所在地など）。無ければnull */
  sub: string | null;
  lat: number;
  lng: number;
  /** 'station'=アプリ内の道の駅データ / 'gsi'=国土地理院 住所検索 */
  source: 'station' | 'gsi';
}

export interface PlaceSearchResult {
  candidates: PlaceCandidate[];
  /** 住所検索API側が失敗したか（道の駅の結果だけは返せている場合がある） */
  geocodeFailed: boolean;
}

const MAX_STATION_HITS = 5;

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
      lat: st.lat,
      lng: st.lng,
      source: 'station',
    });
    if (hits.length >= MAX_STATION_HITS) break;
  }
  return hits;
}

/**
 * 名称・住所での地点検索。道の駅（ローカル）→ 住所検索（国土地理院）の順に並べる。
 * 同名の候補を勝手に1件へ決め打ちせず、候補一覧をそのまま返す。
 */
export async function searchPlaces(query: string, stations: Station[]): Promise<PlaceSearchResult> {
  const q = query.trim();
  if (!q) return { candidates: [], geocodeFailed: false };

  const stationHits = searchStations(q, stations);
  let geocodeFailed = false;
  let geoHits: PlaceCandidate[] = [];
  try {
    const results = await geocode(q);
    geoHits = results.map((r, i) => ({
      id: `gsi:${i}:${r.lat},${r.lng}`,
      label: r.label,
      sub: null,
      lat: r.lat,
      lng: r.lng,
      source: 'gsi' as const,
    }));
  } catch {
    geocodeFailed = true;
  }
  return { candidates: [...stationHits, ...geoHits], geocodeFailed };
}
