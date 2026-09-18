import { describe, expect, it } from 'vitest';
import { BADGE_SYMBOL, STATE_COLOR, markerHtml } from '../lib/markerVisual';

/**
 * 道の駅マーカーの状態表示（落ち着いた配色・C案）。
 *
 * 未訪問=濃い青 / 行きたい=コーラルピンク / 訪問済み=深緑 /
 * スタンプ取得済み=訪問済みと同じ深緑＋赤い「済」バッジ / 開業前=グレー。
 * スタンプ取得済みを独立した紫にはしない（スタンプ取得＝訪問しているため、
 * 訪問済みを含む状態として同じ色で表す）。
 */

/** マーカーHTMLから rs-badge の中身を取り出す（無ければnull） */
function badgeOf(html: string): string | null {
  const m = html.match(/<span class="rs-badge">([^<]*)<\/span>/);
  return m ? m[1] : null;
}

/** マーカーHTMLから、マーク本体の背景色（SVGの角丸四角の塗り）を取り出す */
function fillOf(html: string): string | null {
  const m = html.match(/<rect x="2\.2"[^>]*fill="([^"]+)"/);
  return m ? m[1] : null;
}

describe('マーカーの状態色', () => {
  it('未訪問は濃い青', () => {
    expect(STATE_COLOR.none).toBe('#1a4f9e');
    expect(fillOf(markerHtml('none', 'mne-1'))).toBe('#1a4f9e');
  });

  it('行きたいはコーラルピンク（赤い「済」バッジと混同しない色調）', () => {
    expect(STATE_COLOR.want).toBe('#e06a5a');
    expect(fillOf(markerHtml('want', 'mne-1'))).toBe('#e06a5a');
    expect(STATE_COLOR.want).not.toBe(STATE_COLOR.visited);
  });

  it('訪問済みは深緑', () => {
    expect(STATE_COLOR.visited).toBe('#1f6b4a');
    expect(fillOf(markerHtml('visited', 'mne-1'))).toBe('#1f6b4a');
  });

  it('スタンプ取得済みは訪問済みと同じ深緑（独立した紫にしない）', () => {
    expect(STATE_COLOR.stamp).toBe(STATE_COLOR.visited);
    expect(fillOf(markerHtml('stamp', 'mne-1'))).toBe(fillOf(markerHtml('visited', 'mne-1')));
    // 旧仕様の紫が残っていないこと
    for (const color of Object.values(STATE_COLOR)) {
      expect(color.toLowerCase()).not.toBe('#6a3ab2');
    }
  });

  it('開業前はグレー', () => {
    expect(STATE_COLOR.pre).toBe('#8f959d');
    expect(fillOf(markerHtml('pre', 'mne-1'))).toBe('#8f959d');
  });
});

describe('「済」バッジ', () => {
  it('スタンプ取得済みだけに「済」が付く', () => {
    expect(BADGE_SYMBOL.stamp).toBe('済');
    expect(badgeOf(markerHtml('stamp', 'mne-1'))).toBe('済');
  });

  it('未訪問・行きたい・訪問済み・開業前には「済」を付けない', () => {
    expect(badgeOf(markerHtml('none', 'mne-1'))).toBeNull(); // バッジ自体なし
    expect(badgeOf(markerHtml('want', 'mne-1'))).toBe('★');
    expect(badgeOf(markerHtml('visited', 'mne-1'))).toBe('✓');
    expect(badgeOf(markerHtml('pre', 'mne-1'))).toBe('準');
    for (const state of ['none', 'want', 'visited', 'pre'] as const) {
      expect(badgeOf(markerHtml(state, 'mne-1'))).not.toBe('済');
    }
  });

  it('スタンプ取得済みから別の状態へ変わると「済」が消える', () => {
    expect(badgeOf(markerHtml('stamp', 'mne-1'))).toBe('済');
    // 未訪問へ戻した場合
    expect(badgeOf(markerHtml('none', 'mne-1'))).toBeNull();
    // 訪問済みへ変えた場合（色は同じ深緑のまま、バッジだけ✓に変わる）
    expect(badgeOf(markerHtml('visited', 'mne-1'))).toBe('✓');
    expect(fillOf(markerHtml('visited', 'mne-1'))).toBe(STATE_COLOR.visited);
  });

  it('バッジはマーカー本体の中に置かれ、タップ領域(.rs-hit)と data-sid は従来どおり', () => {
    const html = markerHtml('stamp', 'mne-18900');
    expect(html).toContain('class="rs-hit');
    expect(html).toContain('data-sid="mne-18900"');
    // バッジは .rs-marker の子（別レイヤーに切り出してタップを奪わない）
    expect(html).toMatch(/<div class="rs-marker stamp" data-sid="mne-18900">.*rs-badge.*<\/div>/s);
  });
});

describe('凡例と地図マーカーの一致', () => {
  it('凡例は地図と同じ markerHtml を使うため、状態表示が必ず一致する', () => {
    for (const state of ['none', 'want', 'visited', 'stamp', 'pre'] as const) {
      const map = markerHtml(state, 'mne-1');
      const legend = markerHtml(state, `legend-${state}`);
      expect(fillOf(legend)).toBe(fillOf(map));
      expect(badgeOf(legend)).toBe(badgeOf(map));
    }
  });
});
