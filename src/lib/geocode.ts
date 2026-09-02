/**
 * 住所・地名検索: 国土地理院 住所検索API（無料・APIキー不要）。
 * https://msearch.gsi.go.jp/address-search/AddressSearch?q=...
 * - ボタン押下時のみ呼び出し（連続リクエスト抑制）
 * - 失敗しても呼び出し側は地図指定・道の駅指定で続行できる
 */
export interface GeocodeResult {
  label: string;
  lat: number;
  lng: number;
}

let lastCall = 0;
const MIN_INTERVAL_MS = 1500;

export async function geocode(query: string): Promise<GeocodeResult[]> {
  const q = query.trim();
  if (!q) return [];
  // レート制限: 最低1.5秒間隔
  const now = Date.now();
  const wait = Math.max(0, lastCall + MIN_INTERVAL_MS - now);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();

  const url = `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`住所検索に失敗しました (HTTP ${res.status})`);
  const json: unknown = await res.json();
  if (!Array.isArray(json)) return [];
  const out: GeocodeResult[] = [];
  for (const f of json.slice(0, 5)) {
    const coords = (f as { geometry?: { coordinates?: unknown } })?.geometry?.coordinates;
    const title = (f as { properties?: { title?: unknown } })?.properties?.title;
    if (Array.isArray(coords) && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      out.push({ label: typeof title === 'string' ? title : q, lat: coords[1], lng: coords[0] });
    }
  }
  return out;
}
