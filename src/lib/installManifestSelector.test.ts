import { describe, expect, it } from 'vitest';
import { INSTALL_MANIFEST_SELECTOR_JS, installManifestSelectorScriptTag } from './installManifestSelector';

/** <head>内のインラインscriptとして実行したときの結果（挿入されたmanifestと、読み込み直し先）を返す */
function run(opts: { href: string; standalone?: boolean; stored?: string }) {
  const appended: { rel: string; href: string }[] = [];
  let replacedWith: string | null = null;
  const env = {
    navigator: { standalone: opts.standalone === true },
    window: { matchMedia: () => ({ matches: false }) },
    location: { href: opts.href, replace: (u: string) => (replacedWith = u) },
    localStorage: { getItem: (k: string) => (k === 'michinoeki_access_credential' ? (opts.stored ?? null) : null) },
    document: {
      createElement: () => ({ rel: '', href: '' }),
      head: { appendChild: (l: { rel: string; href: string }) => appended.push(l) },
    },
  };
  const fn = new Function(...Object.keys(env), `${INSTALL_MANIFEST_SELECTOR_JS}('/base/');`);
  fn(...Object.values(env));
  return { manifest: appended.map((l) => `${l.rel}:${l.href}`), replacedWith };
}

describe('HTML解析中のmanifest選択（iOSホーム画面版への招待コード引き継ぎ）', () => {
  it('一般ユーザー（?activate= なし・資格情報なし）は通常manifest', () => {
    expect(run({ href: 'https://x.example/base/' })).toEqual({
      manifest: ['manifest:/base/manifest.webmanifest'],
      replacedWith: null,
    });
  });

  it('Safariで招待コード付きURLとして読み込まれたら、start_url無しの受け渡し用manifest', () => {
    expect(run({ href: 'https://x.example/base/?activate=invite&openExternalBrowser=1' }).manifest).toEqual([
      'manifest:/base/manifest-handoff.webmanifest',
    ]);
  });

  it('招待コードを保存済みでURLに無ければ、?activate= 付きURLで読み込み直す（start_urlに反映させるため）', () => {
    expect(run({ href: 'https://x.example/base/?x=1', stored: 'invite' })).toEqual({
      manifest: [],
      replacedWith: 'https://x.example/base/?x=1&activate=invite',
    });
  });

  it('有料契約者（cs_）は読み込み直さず通常manifest', () => {
    expect(run({ href: 'https://x.example/base/', stored: 'cs_live_paid' })).toEqual({
      manifest: ['manifest:/base/manifest.webmanifest'],
      replacedWith: null,
    });
    expect(run({ href: 'https://x.example/base/?activate=cs_live_paid' }).manifest).toEqual([
      'manifest:/base/manifest.webmanifest',
    ]);
  });

  it('ホーム画面版（standalone）は常に通常manifestで、読み込み直さない', () => {
    expect(run({ href: 'https://x.example/base/', standalone: true, stored: 'invite' })).toEqual({
      manifest: ['manifest:/base/manifest.webmanifest'],
      replacedWith: null,
    });
  });

  it('scriptタグに秘密値になり得る値を含まず、baseだけを埋め込む', () => {
    const tag = installManifestSelectorScriptTag('/tohoku-michinoeki-map/');
    expect(tag.startsWith('<script>')).toBe(true);
    expect(tag).toContain('("/tohoku-michinoeki-map/");</script>');
  });
});
