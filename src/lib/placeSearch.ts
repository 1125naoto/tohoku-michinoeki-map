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
  /**
   * 'station'=アプリ内の道の駅データ / 'osm'=OpenStreetMap Nominatim（施設名）/
   * 'gsi'=国土地理院 住所検索
   */
  source: 'station' | 'osm' | 'gsi';
}

export interface PlaceSearchResult {
  candidates: PlaceCandidate[];
  /** 外部検索（施設名・住所）がどちらも失敗したか（道の駅の結果だけは返せている場合がある） */
  geocodeFailed: boolean;
  /** OpenStreetMap由来の候補を含むか（出典表示の要否） */
  usedOsm: boolean;
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
          sub: r.address,
          lat: r.lat,
          lng: r.lng,
          source: 'osm' as const,
        }))
      : [];
  const gsiHits: PlaceCandidate[] =
    gsiSettled.status === 'fulfilled'
      ? gsiSettled.value.map((r, i) => ({
          id: `gsi:${i}:${r.lat},${r.lng}`,
          label: r.label,
          sub: null,
          lat: r.lat,
          lng: r.lng,
          source: 'gsi' as const,
        }))
      : [];

  // 同じ地点が両方から返ることがあるため、座標の近さで重複を落とす（約10m）
  const seen: { lat: number; lng: number }[] = [];
  const isNew = (c: PlaceCandidate) => {
    if (seen.some((p) => Math.abs(p.lat - c.lat) < 1e-4 && Math.abs(p.lng - c.lng) < 1e-4)) return false;
    seen.push({ lat: c.lat, lng: c.lng });
    return true;
  };

  const candidates = [...stationHits, ...osmHits, ...gsiHits].filter(isNew);
  return {
    candidates,
    geocodeFailed: osmSettled.status === 'rejected' && gsiSettled.status === 'rejected',
    usedOsm: candidates.some((c) => c.source === 'osm'),
  };
}
