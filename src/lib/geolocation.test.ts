import { describe, expect, it } from 'vitest';
import { describeGeolocationError } from './geolocation';

/**
 * 実機テストで「PERMISSION_DENIED/POSITION_UNAVAILABLE/TIMEOUT/Secure Context制限が
 * すべて同じメッセージに潰れている」不具合が報告されたため、error.codeごとに
 * 案内文が変わることを確認する。window/locationが無いNode実行環境（Vitest既定）では
 * isSecureContextを「安全側」に倒す実装のため、その前提で確認する
 * （Secure Context=falseの分岐は実ブラウザでのe2eテストで別途確認済み）。
 */
describe('現在地エラーの案内文（describeGeolocationError）', () => {
  it('POSITION_UNAVAILABLE(code:2)は電波状況を案内する', () => {
    expect(describeGeolocationError({ code: 2 })).toContain('電波状況の良い場所');
  });

  it('TIMEOUT(code:3)は取得に時間がかかっている旨を案内する', () => {
    expect(describeGeolocationError({ code: 3 })).toContain('時間がかかっています');
  });

  it('PERMISSION_DENIED(code:1)は権限拒否の案内をする（window非存在=安全側とみなす既定環境）', () => {
    expect(describeGeolocationError({ code: 1 })).toContain('位置情報の利用が許可されていません');
  });

  it('未知のcodeでも汎用文言でフォールバックする（例外を投げない）', () => {
    expect(describeGeolocationError({ code: 99 })).toBe('現在地がわかりませんでした。');
  });

  it('POSITION_UNAVAILABLE/TIMEOUT/PERMISSION_DENIEDはそれぞれ異なる文言になる（同一メッセージへの退化を防ぐ回帰テスト）', () => {
    const denied = describeGeolocationError({ code: 1 });
    const unavailable = describeGeolocationError({ code: 2 });
    const timeout = describeGeolocationError({ code: 3 });
    expect(new Set([denied, unavailable, timeout]).size).toBe(3);
  });
});
