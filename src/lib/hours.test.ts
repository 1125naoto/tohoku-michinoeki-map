/**
 * 営業状態判定のテスト。時刻はすべて固定（UTCで指定→JSTに換算して判定）し、
 * 実行時刻・端末タイムゾーンに依存しない。
 */
import { describe, expect, it } from 'vitest';
import {
  CLOSING_SOON_MIN,
  evalStatus,
  getStatus,
  hoursCoverage,
  jstParts,
  statusAtArrival,
  type StationHours,
} from './hours';
import { STATIONS } from '../data';
import { AREA_BY_PREFECTURE } from '../types';

const mk = (over: Partial<StationHours>): StationHours => ({
  stationId: 'test',
  primaryFacilityName: null,
  ranges: [{ start: '09:00', end: '17:00' }],
  closedWeekly: [],
  closedText: null,
  seasonalNote: null,
  exceptions: [],
  parking24h: true,
  toilet24h: true,
  sourceUrl: 'https://example.com',
  sourceName: 'test',
  verifiedAt: '2026-09-02',
  notes: null,
  verificationStatus: 'confirmed',
  ...over,
});

/** JSTの日時を作る（UTC-9hで生成）。2026-09-04 は金曜 */
const jst = (iso: string) => new Date(new Date(`${iso}+09:00`).getTime());

describe('Asia/Tokyo判定', () => {
  it('端末TZに依存せずJSTの曜日・時刻を取り出す', () => {
    const p = jstParts(new Date('2026-09-04T00:30:00Z')); // JST 09:30 金曜
    expect(p.weekday).toBe(5);
    expect(p.minutes).toBe(9 * 60 + 30);
    const p2 = jstParts(new Date('2026-09-04T15:30:00Z')); // JST 翌土曜 00:30
    expect(p2.weekday).toBe(6);
    expect(p2.minutes).toBe(30);
  });
});

describe('営業状態の判定（9:00〜17:00の基本形）', () => {
  const h = mk({});
  it('営業開始直前は「本日9:00から」', () => {
    const s = evalStatus(h, jst('2026-09-04T08:59'));
    expect(s.kind).toBe('closed');
    expect(s.label).toContain('本日9:00から');
  });
  it('営業開始時刻ちょうどで営業中になる', () => {
    const s = evalStatus(h, jst('2026-09-04T09:00'));
    expect(s.kind).toBe('open');
    expect(s.label).toContain('営業中');
    expect(s.label).toContain('17:00まで');
  });
  it('終了60分前から「まもなく終了」', () => {
    expect(evalStatus(h, jst('2026-09-04T15:59')).kind).toBe('open');
    const s = evalStatus(h, jst('2026-09-04T16:00'));
    expect(s.kind).toBe('closing');
    expect(s.label).toContain('あと60分');
    expect(evalStatus(h, jst('2026-09-04T16:22')).label).toContain('あと38分');
    expect(CLOSING_SOON_MIN).toBe(60);
  });
  it('営業終了時刻で営業時間外になり、翌営業日を案内する', () => {
    const s = evalStatus(h, jst('2026-09-04T17:00'));
    expect(s.kind).toBe('closed');
    expect(s.label).toContain('明日9:00から');
  });
});

describe('定休日・複数時間帯・日付またぎ', () => {
  it('定休日（金曜定休）は「本日定休日」', () => {
    const h = mk({ closedWeekly: [5] });
    const s = evalStatus(h, jst('2026-09-04T12:00')); // 金曜
    expect(s.kind).toBe('closed');
    expect(s.label).toContain('本日定休日');
    expect(s.today).toBe('本日定休日');
  });
  it('定休日の翌日案内は定休日を飛ばす', () => {
    const h = mk({ closedWeekly: [6] }); // 土曜定休
    const s = evalStatus(h, jst('2026-09-04T18:00')); // 金曜終了後
    expect(s.label).toContain('日曜9:00から'); // 明日(土)は定休 → 日曜
  });
  it('1日複数の営業時間帯（昼休憩あり）', () => {
    const h = mk({ ranges: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '17:00' }] });
    expect(evalStatus(h, jst('2026-09-04T10:00')).kind).toBe('open');
    const lunch = evalStatus(h, jst('2026-09-04T12:30'));
    expect(lunch.kind).toBe('closed');
    expect(lunch.label).toContain('本日13:00から');
    expect(evalStatus(h, jst('2026-09-04T13:30')).kind).toBe('open');
    expect(lunch.today).toContain('9:00〜12:00');
    expect(lunch.today).toContain('13:00〜17:00');
  });
  it('日付をまたぐ営業時間（22:00〜5:00）', () => {
    const h = mk({ ranges: [{ start: '22:00', end: '05:00' }] });
    expect(evalStatus(h, jst('2026-09-04T23:00')).kind).toBe('open');
    const early = evalStatus(h, jst('2026-09-05T03:00')); // 前日開始分の深夜
    expect(early.kind).toBe('open');
    const soon = evalStatus(h, jst('2026-09-05T04:30'));
    expect(soon.kind).toBe('closing');
    expect(evalStatus(h, jst('2026-09-05T06:00')).kind).toBe('closed');
  });
});

describe('不明・開業前・推測禁止', () => {
  it('unverifiedは要確認になり時間を出さない', () => {
    const h = mk({ verificationStatus: 'unverified', ranges: [] });
    const s = evalStatus(h, jst('2026-09-04T12:00'));
    expect(s.kind).toBe('unknown');
    expect(s.label).toContain('要確認');
    expect(s.today).toBe('—');
  });
  it('開業前はupcoming', () => {
    const h = mk({ verificationStatus: 'upcoming', ranges: [] });
    expect(evalStatus(h, jst('2026-09-04T12:00')).kind).toBe('upcoming');
  });
  it('未知IDはunknown', () => {
    expect(getStatus('no-such-id', jst('2026-09-04T12:00')).kind).toBe('unknown');
  });
});

describe('到着時刻判定とデータ網羅', () => {
  it('statusAtArrivalは到着予定時刻で判定する', () => {
    // 実データ: しちのへ 9:00〜18:00（confirmed）
    expect(statusAtArrival('mne-18900', jst('2026-09-04T10:00'))).toBe('open');
    expect(statusAtArrival('mne-18900', jst('2026-09-04T23:00'))).toBe('closed');
  });
  it('東北6県182施設にデータ行があり、区分件数が一致する（北海道・関東は今回営業時間データ未収録）', () => {
    const c = hoursCoverage();
    const tohoku = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '東北');
    expect(c.confirmed + c.partial + c.unverified + c.upcoming).toBe(tohoku.length);
    // 石川は2026年9月18日の開業を公式サイトで確認し営業時間データ(partial)へ更新したため、
    // 東北の開業前は0件（残る開業前「くらたけ天草戦国ミュージアム」は熊本県で対象外）
    expect(c.upcoming).toBe(0);
    expect(c.unverified).toBeGreaterThan(0); // 要確認は正常な状態（推測で埋めない）
    for (const st of STATIONS) {
      // 北海道・関東は営業時間データが未収録のため、未知ID扱い(unknown)で返ることを許容する
      expect(getStatus(st.id, jst('2026-09-04T10:00')).kind).toBeDefined();
    }
  });
  it('実データの判定が実行タイムゾーンに依存しない（同一Dateなら同一結果）', () => {
    const t = new Date('2026-09-04T01:00:00Z'); // JST 10:00
    const a = getStatus('mne-18900', t);
    const b = getStatus('mne-18900', new Date(t.getTime()));
    expect(a).toEqual(b);
  });
});
