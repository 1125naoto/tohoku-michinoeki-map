import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeGeolocationError, getBestCurrentPosition } from './geolocation';

function mockGeolocation(impl: (success: PositionCallback, error: PositionErrorCallback) => void) {
  const getCurrentPosition = vi.fn(impl);
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition }, userAgent: 'test' });
  return getCurrentPosition;
}

function fakePosition(lat: number, lng: number): GeolocationPosition {
  return {
    coords: {
      latitude: lat,
      longitude: lng,
      accuracy: 10,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      toJSON() {
        return this;
      },
    },
    timestamp: Date.now(),
    toJSON() {
      return this;
    },
  };
}

function fakeError(code: number): GeolocationPositionError {
  return { code, message: `err${code}`, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError;
}

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

  it('iPhoneのUAではPERMISSION_DENIEDにiOS設定への具体的な案内を追加する', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' });
    expect(describeGeolocationError({ code: 1 })).toContain('iPhoneの位置情報設定');
    vi.unstubAllGlobals();
  });
});

/**
 * PART A: iOS Safariでは navigator.permissions.query の状態が実際の取得可否と
 * 食い違うことがあるため、Permissions APIでは判断せず getCurrentPosition() の
 * 成功/失敗コールバックだけを信じる。1回目は高精度、POSITION_UNAVAILABLE/TIMEOUTの
 * 場合のみ低精度で1回だけ再試行し、PERMISSION_DENIEDでは再試行しないことを検証する。
 */
describe('getBestCurrentPosition（現在地取得の共通ロジック）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('1回目(高精度)で成功したら2回目は試行しない', async () => {
    const getCurrentPosition = mockGeolocation((success) => success(fakePosition(38.26, 140.87)));
    const result = await getBestCurrentPosition();
    expect(result.position?.coords.latitude).toBe(38.26);
    expect(result.attempts).toEqual([expect.objectContaining({ accuracy: 'high', ok: true })]);
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it('PERMISSION_DENIEDは再試行しない', async () => {
    mockGeolocation((_success, error) => error(fakeError(1)));
    const result = await getBestCurrentPosition();
    expect(result.position).toBeNull();
    expect(result.error?.code).toBe(1);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]).toMatchObject({ accuracy: 'high', ok: false, code: 1 });
  });

  it('POSITION_UNAVAILABLE(2)は低精度で1回だけ再試行し、2回目が成功すればそれを返す', async () => {
    let call = 0;
    mockGeolocation((success, error) => {
      call += 1;
      if (call === 1) error(fakeError(2));
      else success(fakePosition(39.7, 141.15));
    });
    const result = await getBestCurrentPosition();
    expect(result.position?.coords.latitude).toBe(39.7);
    expect(result.attempts).toEqual([
      expect.objectContaining({ accuracy: 'high', ok: false, code: 2 }),
      expect.objectContaining({ accuracy: 'low', ok: true }),
    ]);
  });

  it('TIMEOUT(3)は低精度で再試行し、それも失敗すれば2回目のエラーを返す', async () => {
    let call = 0;
    mockGeolocation((_success, error) => {
      call += 1;
      error(fakeError(call === 1 ? 3 : 2));
    });
    const result = await getBestCurrentPosition();
    expect(result.position).toBeNull();
    expect(result.error?.code).toBe(2);
    expect(result.attempts).toEqual([
      expect.objectContaining({ accuracy: 'high', ok: false, code: 3 }),
      expect.objectContaining({ accuracy: 'low', ok: false, code: 2 }),
    ]);
  });
});
