/**
 * Service Workerの新版を「いつ適用（再読み込み）するか」の判定。
 *
 * 背景（Owner iPhone実機で再現した白画面）:
 * 旅行中などの操作中は再読み込みを延期する仕組みを入れたが、その延期解除の条件に
 * 「画面が隠れたら適用する」を含めていた。戻る操作・他アプリへの切り替えでページが
 * hidden になる瞬間に location.reload() を呼ぶことになり、iOS Safariでは
 * 破棄されようとしている（BFCacheへ入る）ページを再読み込みすることになって、
 * 戻ってきたときにアプリが描画されない空白ページが残った。
 *
 * 方針:
 * - 隠れている間は絶対に再読み込みしない（去っていくページを触らない）
 * - 操作中も再読み込みしない（作りかけ・進行中の内容を壊さない）
 * - 「表示されている」かつ「操作中でない」ときにだけ適用する
 * 更新自体をスキップはしない。条件が整った時点で必ず適用される。
 */
export interface SwUpdateDeps {
  /** いま操作中か（旅行中・コース作成中など） */
  isBusy: () => boolean;
  /** ページが表示されているか */
  isVisible: () => boolean;
  /** 実際の適用（本番では location.reload()） */
  reload: () => void;
  /** 状態が変わりうるタイミングの購読。解除関数を返す */
  subscribe: (onChange: () => void) => () => void;
}

export interface SwUpdateScheduler {
  /** 新版が有効になったことを伝える */
  notifyUpdateReady: () => void;
  /** 保留中の更新があるか（テスト・診断用） */
  isPending: () => boolean;
  /** 監視を止める */
  dispose: () => void;
}

export function createSwUpdateScheduler(deps: SwUpdateDeps): SwUpdateScheduler {
  let pending = false;
  let applied = false;
  let unsubscribe: (() => void) | null = null;

  const canApplyNow = () => deps.isVisible() && !deps.isBusy();

  const stopWatching = () => {
    unsubscribe?.();
    unsubscribe = null;
  };

  const tryApply = () => {
    if (applied || !pending) return;
    if (!canApplyNow()) return;
    applied = true;
    pending = false;
    stopWatching();
    deps.reload();
  };

  return {
    notifyUpdateReady() {
      if (applied) return;
      pending = true;
      if (canApplyNow()) {
        tryApply();
        return;
      }
      if (!unsubscribe) unsubscribe = deps.subscribe(tryApply);
    },
    isPending: () => pending,
    dispose: stopWatching,
  };
}
