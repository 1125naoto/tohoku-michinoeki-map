/**
 * iOSのホーム画面版へ招待コード（ナミちゃん用）を引き継ぐための、manifestリンクの選択スクリプト。
 * vite.config.ts の installManifestSelectorPlugin が、vite-plugin-pwa の挿入した
 * <link rel="manifest"> をこのスクリプト（<head>内の同期インラインscript）に置き換える。
 *
 * なぜHTMLの解析中に決める必要があるか（WebKitの実装より）:
 * - HTMLLinkElement::process が <link rel="manifest"> を処理した時点で
 *   DocumentLoader::loadApplicationManifest が走り、そのページ読み込みでは最初に読み込んだ
 *   manifestがキャッシュされる。読み込み後にhrefを差し替えても無視される。
 * - start_url が無いmanifestでは、start_url = DocumentLoader::url()（このページを読み込んだ
 *   リクエストURL）。history.replaceState で後から変えたURLではない。
 * - iOSのホーム画面版はSafariとlocalStorageを共有せず、manifestのstart_urlから起動する。
 *
 * そこで、ブラウザのタブで招待コード付きURL（?activate=）として読み込まれたページだけ、
 * 解析中に start_url を持たない manifest-handoff.webmanifest を選ぶ。ホーム画面版の起動URLは
 * 「招待コード付きの読み込みURL」になり、ホーム画面版自身が起動のたびに自分のlocalStorageへ
 * 保存する。招待コードを保存済みだが今回のURLに無い場合は、?activate= 付きURLで読み込み直す
 * （読み込みURLに含めないとstart_urlに反映されないため）。
 *
 * 一般ユーザー・有料契約者（StripeのCheckout Session ID = cs_）は常に通常のmanifest。
 * 秘密値はこのスクリプトにも、どのmanifestにも含まれない（その端末のURLにだけ存在する）。
 * キー名・パラメータ名は accessCredential.ts と一致させること。
 */
export const INSTALL_MANIFEST_SELECTOR_JS = `(function (base) {
  var href = base + 'manifest.webmanifest';
  try {
    var standalone =
      navigator.standalone === true ||
      (!!window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    if (!standalone) {
      var url = new URL(location.href);
      var code = url.searchParams.get('activate');
      if (code === null) {
        var stored = localStorage.getItem('michinoeki_access_credential');
        if (stored && stored.indexOf('cs_') !== 0) {
          url.searchParams.set('activate', stored);
          location.replace(url.href);
          return;
        }
      } else if (code && code.indexOf('cs_') !== 0) {
        href = base + 'manifest-handoff.webmanifest';
      }
    }
  } catch (e) {}
  var link = document.createElement('link');
  link.rel = 'manifest';
  link.href = href;
  document.head.appendChild(link);
})`;

/** index.html の <head> に埋め込む完全なscriptタグ */
export function installManifestSelectorScriptTag(base: string): string {
  return `<script>${INSTALL_MANIFEST_SELECTOR_JS}(${JSON.stringify(base)});</script>`;
}
