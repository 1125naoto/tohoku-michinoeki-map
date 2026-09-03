/**
 * 営業時間データと営業状態の判定。
 *
 * - 判定は必ず Asia/Tokyo（UTC+9固定・DSTなし）。端末のタイムゾーンに依存しない。
 * - 「営業中」は登録済みの通常営業時間に基づく目安であり、臨時休業・季節変更は
 *   反映しない（UIに注意書きを表示する）。
 * - 情報を確認できない施設は推測せず 'unknown'（要確認）として扱う。
 */
import raw from '../data/hours.json';

export interface TimeRange {
  start: string; // "09:00"
  end: string; // "18:00"（start より小さい場合は日付またぎ）
}

export interface StationHours {
  stationId: string;
  primaryFacilityName: string | null;
  /** メイン施設の営業時間帯（1日複数可） */
  ranges: TimeRange[];
  /** 定休曜日（0=日〜6=土） */
  closedWeekly: number[];
  /** 定休日の原文（日付・年末年始・第◯曜など） */
  closedText: string | null;
  /** 季節変動がある場合の原文 */
  seasonalNote: string | null;
  /** 臨時休業等（将来拡張用。静的データでは判定不可） */
  exceptions: unknown[];
  parking24h: boolean | null;
  toilet24h: boolean | null;
  sourceUrl: string;
  sourceName: string;
  verifiedAt: string;
  notes: string | null;
  verificationStatus: 'confirmed' | 'partial' | 'unverified' | 'upcoming';
}

interface HoursFile {
  meta: { verifiedAt: string; closingSoonMin: number; sources: { name: string; url: string }[]; notes: string[] };
  hours: StationHours[];
}

const data = raw as unknown as HoursFile;

/** 「まもなく終了」とみなす残り分数（将来変更できるよう定数化） */
export const CLOSING_SOON_MIN = data.meta.closingSoonMin ?? 60;

export const HOURS_META = data.meta;

const byId = new Map(data.hours.map((h) => [h.stationId, h]));

export function getHours(stationId: string): StationHours | undefined {
  return byId.get(stationId);
}

export type HoursKind = 'open' | 'closing' | 'closed' | 'unknown' | 'upcoming';

export interface HoursStatus {
  kind: HoursKind;
  /** 例: 「営業中 17:00まで」「まもなく終了 あと38分」「営業時間外 本日定休日」 */
  label: string;
  /** 今日の営業時間の短い表記（例 "9:00〜17:00" / "本日定休日" / "—"） */
  today: string;
  /** 営業中/まもなく終了のとき、終了までの分数 */
  minutesToClose?: number;
}

/** JSTの (曜日, 分単位時刻) を端末TZ非依存で取り出す */
export function jstParts(now: Date): { weekday: number; minutes: number } {
  const jst = new Date(now.getTime() + 9 * 3600 * 1000);
  return { weekday: jst.getUTCDay(), minutes: jst.getUTCHours() * 60 + jst.getUTCMinutes() };
}

const toMin = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

const fmtRange = (r: TimeRange) => `${r.start.replace(/^0/, '')}〜${r.end.replace(/^0/, '')}`;

function rangesText(h: StationHours): string {
  return h.ranges.map(fmtRange).join(' / ');
}

/**
 * 指定時刻（既定は現在）における営業状態を判定する。
 * closingSoonMin 分前から「まもなく終了」。
 */
export function getStatus(stationId: string, now: Date = new Date()): HoursStatus {
  const h = byId.get(stationId);
  if (!h) return { kind: 'unknown', label: '要確認 公式サイトで確認してください', today: '—' };
  return evalStatus(h, now);
}

/** 判定コア（テストから合成データで直接呼べるよう分離） */
export function evalStatus(h: StationHours, now: Date): HoursStatus {
  if (h.verificationStatus === 'upcoming') {
    return { kind: 'upcoming', label: '開業前', today: '—' };
  }
  if (h.verificationStatus === 'unverified' || h.ranges.length === 0) {
    return { kind: 'unknown', label: '要確認 公式サイトで確認してください', today: '—' };
  }

  const { weekday, minutes } = jstParts(now);

  // 本日が定休日か
  const closedToday = h.closedWeekly.includes(weekday);
  // 前日から日付またぎで続いている営業時間帯のチェック
  const prevWeekday = (weekday + 6) % 7;
  const prevOpen = !h.closedWeekly.includes(prevWeekday);
  if (prevOpen) {
    for (const r of h.ranges) {
      const s = toMin(r.start);
      const e = toMin(r.end);
      if (e < s && minutes < e) {
        // 前日開始の深夜帯の中にいる
        const left = e - minutes;
        if (left <= CLOSING_SOON_MIN) return { kind: 'closing', label: `まもなく終了 あと${left}分`, today: rangesText(h), minutesToClose: left };
        return { kind: 'open', label: `営業中 ${r.end.replace(/^0/, '')}まで`, today: rangesText(h), minutesToClose: left };
      }
    }
  }

  if (closedToday) {
    return { kind: 'closed', label: '営業時間外 本日定休日', today: '本日定休日' };
  }

  // 今日の時間帯を順にチェック
  let nextStart: number | null = null;
  for (const r of h.ranges) {
    const s = toMin(r.start);
    let e = toMin(r.end);
    if (e < s) e += 24 * 60; // 日付またぎは当日側では終端を延長して扱う
    if (minutes >= s && minutes < e) {
      const left = e - minutes;
      if (left <= CLOSING_SOON_MIN) {
        return { kind: 'closing', label: `まもなく終了 あと${left}分`, today: rangesText(h), minutesToClose: left };
      }
      return { kind: 'open', label: `営業中 ${r.end.replace(/^0/, '')}まで`, today: rangesText(h), minutesToClose: left };
    }
    if (minutes < s && (nextStart === null || s < nextStart)) nextStart = s;
  }

  if (nextStart !== null) {
    const hh = Math.floor(nextStart / 60);
    const mm = String(nextStart % 60).padStart(2, '0');
    return { kind: 'closed', label: `営業時間外 本日${hh}:${mm}から`, today: rangesText(h) };
  }

  // 本日は終了 → 翌営業日の開始を案内
  for (let d = 1; d <= 7; d++) {
    const wd = (weekday + d) % 7;
    if (!h.closedWeekly.includes(wd)) {
      const first = h.ranges.reduce((a, b) => (toMin(a.start) <= toMin(b.start) ? a : b));
      const when = d === 1 ? '明日' : `${'日月火水木金土'[wd]}曜`;
      return { kind: 'closed', label: `営業時間外 ${when}${first.start.replace(/^0/, '')}から`, today: rangesText(h) };
    }
  }
  return { kind: 'closed', label: '営業時間外 本日は終了', today: rangesText(h) };
}

/** 到着予定時刻での営業見込み（ルート計画用） */
export type ArrivalHours = 'open' | 'closing' | 'closed' | 'unknown';

export function statusAtArrival(stationId: string, arriveAt: Date): ArrivalHours {
  const s = getStatus(stationId, arriveAt);
  if (s.kind === 'upcoming') return 'closed';
  if (s.kind === 'unknown') return 'unknown';
  return s.kind;
}

/** 一覧集計（最終報告・結果カード用） */
export function hoursCoverage(): { confirmed: number; partial: number; unverified: number; upcoming: number } {
  const c = { confirmed: 0, partial: 0, unverified: 0, upcoming: 0 };
  for (const h of data.hours) c[h.verificationStatus]++;
  return c;
}
