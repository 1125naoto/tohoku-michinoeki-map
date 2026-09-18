/**
 * 道の駅マーカーの見た目（状態色・バッジ・SVG）を組み立てる純粋な関数群。
 *
 * MapView.tsx から切り出してある。MapViewはLeafletを読み込むため単体テストから
 * importできないが、状態と表示の対応は回帰テストで守りたいため、描画に必要な
 * ロジックだけをDOM非依存のこのファイルへ置く（挙動は従来と同一）。
 */
import type { HoursKind } from './hours';

/** マーカーの表示状態（訪問状態＋開業前） */
export type MarkerState = 'none' | 'want' | 'visited' | 'stamp' | 'pre';

/**
 * 状態ごとのマーク背景色（白い図形は全状態で白のまま維持）。
 *
 * 落ち着いた配色（C案）。スタンプ取得済みを独立した色にはせず、
 * 「訪問済み」と同じ深緑のまま右上の赤い「済」バッジだけで区別する
 * （スタンプを取得した＝その駅を訪問している、という包含関係を色で表す）。
 */
export const STATE_COLOR: Record<MarkerState, string> = {
  none: '#1a4f9e', // 未訪問: 濃い青
  want: '#e06a5a', // 行きたい: コーラルピンク
  visited: '#1f6b4a', // 訪問済み: 深緑
  stamp: '#1f6b4a', // スタンプ取得済み: 訪問済みと同じ深緑（区別は赤い「済」バッジ）
  pre: '#8f959d', // 開業前: グレー
};

/**
 * 道の駅マーク（独自作成SVG）。
 * 公式シンボルマークは国土交通省の登録商標で利用申請が必要なため画像素材は使用せず、
 * 案内標識で一般的な意匠の特徴（角丸正方形・白い2本の木・丸窓と縦長入口のある
 * 白い家・下部の白い道路ライン）を独自に描画したベクターデータ。
 * 背景色は訪問状態で変わる（color引数）。外周に白い縁取りを持つ。
 */
const signSvg = (color: string) =>
  '<svg viewBox="0 0 60 60" aria-hidden="true">' +
  // 白い縁取り + 状態色の角丸正方形
  '<rect x="0" y="0" width="60" height="60" rx="12" fill="#ffffff"/>' +
  `<rect x="2.2" y="2.2" width="55.6" height="55.6" rx="10" fill="${color}"/>` +
  // 白い木（左奥・大）: 丸い樹冠 + 幹（2本が別々の木に見えるよう間隔を確保）
  '<circle cx="18.5" cy="17.5" r="5.6" fill="#fff"/>' +
  '<circle cx="15" cy="22.5" r="4.3" fill="#fff"/>' +
  '<circle cx="22" cy="22.5" r="4.3" fill="#fff"/>' +
  '<rect x="17" y="24" width="3.1" height="22.8" fill="#fff"/>' +
  // 白い木（左手前・小）
  '<circle cx="7" cy="29" r="3.9" fill="#fff"/>' +
  '<circle cx="4.7" cy="32.5" r="3" fill="#fff"/>' +
  '<circle cx="9.3" cy="32.5" r="3" fill="#fff"/>' +
  '<rect x="5.8" y="33.5" width="2.6" height="13.3" fill="#fff"/>' +
  // 白い家（右）: 切妻屋根の輪郭
  '<path d="M29 24.5 L41.5 12.5 L54 24.5 V43.5 H29 Z" fill="#fff"/>' +
  // 家の中の丸い窓（背景色で抜く）
  `<circle cx="41.5" cy="26.5" r="3.6" fill="${color}"/>` +
  // 家の中の縦長の入口（背景色で抜く）
  `<rect x="38.4" y="33.5" width="6.2" height="10" fill="${color}"/>` +
  // 下部の白い道路ライン
  '<rect x="5" y="46.5" width="50" height="5.2" rx="1.2" fill="#fff"/>' +
  '</svg>';

export const BADGE_SYMBOL: Record<MarkerState, string> = {
  none: '',
  want: '★',
  visited: '✓',
  stamp: '済',
  pre: '準',
};

/** 営業状態ドット（マーカー左下）: 色+記号の二重符号化。訪問状態の色と混同しない別バッジ */
const HOURS_DOT: Record<HoursKind, { cls: string; glyph: string } | null> = {
  open: { cls: 'hrs-open', glyph: '' }, // 緑・中抜きリング
  closing: { cls: 'hrs-closing', glyph: '!' }, // 黄
  closed: { cls: 'hrs-closed', glyph: '×' }, // 濃グレー
  unknown: { cls: 'hrs-unknown', glyph: '?' }, // グレー
  upcoming: null, // 開業前は既存の「準」バッジのみ
};

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function markerHtml(
  state: MarkerState,
  stationId: string,
  hoursKind?: HoursKind,
  name?: string,
  selected?: boolean,
  /** ルート選択中の番号（1始まり）。訪問状態色は変えず、別の外周リング+番号バッジで表す */
  routeSelectNumber?: number,
): string {
  const badge = state === 'none' ? '' : `<span class="rs-badge">${BADGE_SYMBOL[state]}</span>`;
  const dotSpec = hoursKind ? HOURS_DOT[hoursKind] : null;
  const dot = dotSpec ? `<span class="hrs-dot ${dotSpec.cls}" aria-hidden="true">${dotSpec.glyph}</span>` : '';
  // 駅名ラベル: stations.json由来の名前をマーカー中央下へ（pointer-events:none・タップを奪わない）
  // 表示上は共通の「道の駅」を省略。表示/非表示はズーム連動のCSSクラスで制御
  const label = name ? `<span class="rs-label" aria-hidden="true">${escapeHtml(name)}</span>` : '';
  const picked = routeSelectNumber != null;
  const numBadge = picked
    ? `<span class="rs-route-num" data-testid="route-select-num" aria-hidden="true">${routeSelectNumber}</span>`
    : '';
  // .rs-hit = 44×44の透明タップ領域。見た目の縮小はCSS transformで行い、タップ領域は維持する
  return (
    `<div class="rs-hit${selected ? ' sel' : ''}${picked ? ' picked' : ''}">` +
    `<div class="rs-marker ${state}" data-sid="${stationId}">${signSvg(STATE_COLOR[state])}${badge}${dot}${numBadge}</div>` +
    `${label}</div>`
  );
}

