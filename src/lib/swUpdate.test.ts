import { describe, expect, it } from 'vitest';
import { createSwUpdateScheduler } from './swUpdate';

/** 表示状態・操作中・購読を差し替えられるテスト用の土台 */
function harness(init: { visible?: boolean; busy?: boolean } = {}) {
  const state = { visible: init.visible ?? true, busy: init.busy ?? false };
  const reloads: { visible: boolean; busy: boolean }[] = [];
  let notify: (() => void) | null = null;
  let unsubscribed = false;

  const scheduler = createSwUpdateScheduler({
    isBusy: () => state.busy,
    isVisible: () => state.visible,
    reload: () => reloads.push({ visible: state.visible, busy: state.busy }),
    subscribe: (onChange) => {
      notify = onChange;
      return () => {
        unsubscribed = true;
        notify = null;
      };
    },
  });

  return {
    scheduler,
    reloads,
    state,
    /** 表示状態・操作状態が変わったことを伝える（実装側のvisibilitychange/定期確認に相当） */
    tick: () => notify?.(),
    get unsubscribed() {
      return unsubscribed;
    },
  };
}

describe('Service Worker更新の適用タイミング', () => {
  it('表示中かつ操作していなければ、すぐ適用する', () => {
    const h = harness({ visible: true, busy: false });
    h.scheduler.notifyUpdateReady();
    expect(h.reloads.length).toBe(1);
    expect(h.scheduler.isPending()).toBe(false);
  });

  it('操作中（旅行中・コース作成中）は適用しない', () => {
    const h = harness({ visible: true, busy: true });
    h.scheduler.notifyUpdateReady();
    expect(h.reloads).toEqual([]);
    expect(h.scheduler.isPending()).toBe(true);
  });

  it('回帰（Owner実機の白画面）: 画面が隠れた瞬間には絶対に再読み込みしない', () => {
    // 旅行中に新版が有効化された状態を作る
    const h = harness({ visible: true, busy: true });
    h.scheduler.notifyUpdateReady();
    expect(h.reloads).toEqual([]);

    // 戻る操作・他アプリへの切り替えでページが隠れる
    h.state.visible = false;
    h.tick();
    // 去っていくページを再読み込みしない（iOS Safariで空白ページが残る原因だった）
    expect(h.reloads).toEqual([]);
    expect(h.scheduler.isPending()).toBe(true);
  });

  it('回帰: 操作を終えていても、隠れている間は適用しない', () => {
    const h = harness({ visible: true, busy: true });
    h.scheduler.notifyUpdateReady();
    h.state.busy = false;
    h.state.visible = false;
    h.tick();
    expect(h.reloads).toEqual([]);
    expect(h.scheduler.isPending()).toBe(true);
  });

  it('戻ってきて（表示）操作も終わっていれば、そこで適用される（更新をスキップしない）', () => {
    const h = harness({ visible: true, busy: true });
    h.scheduler.notifyUpdateReady();

    h.state.visible = false; // いったん離れる
    h.tick();
    expect(h.reloads).toEqual([]);

    h.state.visible = true; // 戻ってくる。まだ旅行中なので適用しない
    h.tick();
    expect(h.reloads).toEqual([]);

    h.state.busy = false; // 旅行を終えた
    h.tick();
    expect(h.reloads.length).toBe(1);
    expect(h.reloads[0]).toEqual({ visible: true, busy: false });
    expect(h.scheduler.isPending()).toBe(false);
  });

  it('適用は1回だけで、以後は監視を止める', () => {
    const h = harness({ visible: true, busy: true });
    h.scheduler.notifyUpdateReady();
    h.state.busy = false;
    h.tick();
    h.tick();
    h.tick();
    expect(h.reloads.length).toBe(1);
    expect(h.unsubscribed).toBe(true);
  });

  it('更新が来ていなければ、状態が変わっても何もしない', () => {
    const h = harness({ visible: true, busy: false });
    h.tick();
    expect(h.reloads).toEqual([]);
    expect(h.scheduler.isPending()).toBe(false);
  });
});
