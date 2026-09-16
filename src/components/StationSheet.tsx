import { useState } from 'react';
import type { Station, StationState, VisitMap } from '../types';
import { stationSearchUrl } from '../lib/gmaps';
import { getHours, getStatus, type HoursKind } from '../lib/hours';

interface Props {
  station: Station;
  visits: VisitMap;
  onSetState: (id: string, state: StationState) => void;
  onClose: () => void;
  /** この駅の周辺で観光・グルメ・温泉・宿を探す（駅詳細のPRIMARY導線） */
  onSearchNearby: () => void;
}

const STATION_STATUS_LABEL: Record<string, string> = {
  open: '営業中',
  pre_open: '登録済み・開業前',
  closed_temp: '一時休業',
  unknown: '状態未確認',
};

const HOURS_BADGE: Record<HoursKind, { cls: string; text: string }> = {
  open: { cls: 'hopen', text: '営業中' },
  closing: { cls: 'want', text: 'まもなく終了' },
  closed: { cls: 'hclosed', text: '営業時間外' },
  unknown: { cls: 'pre', text: '要確認' },
  upcoming: { cls: 'pre', text: '開業前' },
};

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

export default function StationSheet({ station: st, visits, onSetState, onClose, onSearchNearby }: Props) {
  const state = visits[st.id]?.state ?? 'unvisited';
  const rec = visits[st.id];
  const [hoursOpen, setHoursOpen] = useState(false);
  const hs = getStatus(st.id);
  const hd = getHours(st.id);

  return (
    <>
      <section className="sheet" data-testid="station-sheet" aria-label={`道の駅${st.name}の詳細`}>
        <div className="sheet-grip" />
        <button className="sheet-x" onClick={onClose} aria-label="閉じる" data-testid="sheet-x">
          ✕
        </button>
        <h2>道の駅 {st.name}</h2>
        {st.kana && <p className="kana">{st.kana}</p>}
        <p className="addr">
          {st.pref} {st.city}
        </p>
        <p className="addr">{st.address}</p>
        <p style={{ margin: '6px 0' }}>
          {st.status !== 'open' && <span className="badge pre">{STATION_STATUS_LABEL[st.status]}</span>}
          {st.status === 'open' && state === 'unvisited' && <span className="badge none">未訪問</span>}
          {state === 'wishlist' && <span className="badge want">★ 行きたい</span>}
          {state === 'visited' && <span className="badge visited">✓ 訪問済み</span>}
          {state === 'stamped' && <span className="badge stamp">印 スタンプ取得済み</span>}
        </p>
        {rec?.visitedAt && (state === 'visited' || state === 'stamped') && (
          <p className="addr">訪問日: {new Date(rec.visitedAt).toLocaleDateString('ja-JP')}</p>
        )}
        {(st.facilities?.rvPark === 'yes' || st.facilities?.onsen === 'yes') && (
          <p style={{ margin: '4px 0' }} data-testid="station-facilities">
            {st.facilities?.rvPark === 'yes' && <span className="badge visited">🚐 RVパーク</span>}{' '}
            {st.facilities?.onsen === 'yes' && <span className="badge visited">♨️ 温泉</span>}
          </p>
        )}
        {(st.facilities?.rvPark === 'unknown' || st.facilities?.onsen === 'unknown') && (
          <p className="addr" style={{ fontSize: 11 }}>
            設備情報 未確認（RVパーク・温泉）
          </p>
        )}
        {st.note && <div className="note-box">ℹ️ {st.note}</div>}
        {st.status === 'pre_open' && (
          <div className="note-box">この駅は開業前のため、状態変更とルート提案の対象外です。</div>
        )}

        {/* 営業時間 */}
        <div className="note-box" data-testid="hours-block" style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className={`badge ${HOURS_BADGE[hs.kind].cls}`} data-testid="hours-status">
              {hs.label}
            </span>
          </div>
          {hs.kind !== 'upcoming' && hs.kind !== 'unknown' && (
            <div style={{ marginTop: 4 }} data-testid="hours-today">
              本日の営業時間: {hs.today}
            </div>
          )}
          {hs.kind === 'unknown' && (
            <div style={{ marginTop: 4 }} data-testid="hours-today">
              営業時間の掲載がないため、公式情報をご確認ください。
            </div>
          )}
          {hd && hd.verificationStatus !== 'upcoming' && (
            <>
              <button
                style={{ width: '100%', marginTop: 8, minHeight: 40, fontSize: 13 }}
                onClick={() => setHoursOpen(!hoursOpen)}
                aria-expanded={hoursOpen}
                data-testid="hours-detail-toggle"
              >
                {hoursOpen ? '▲ 営業時間の詳細をとじる' : '▼ 営業時間の詳細を見る'}
              </button>
              {hoursOpen && (
                <div style={{ marginTop: 8, fontSize: 13 }} data-testid="hours-detail">
                  {hd.ranges.length > 0 && (
                    <div>
                      通常営業時間: {hd.ranges.map((r) => `${r.start}〜${r.end}`).join(' / ')}
                      （毎日{hd.closedWeekly.length > 0 ? `・${hd.closedWeekly.map((w) => WEEKDAY_JA[w]).join('・')}曜定休` : ''}）
                    </div>
                  )}
                  {hd.closedText && <div>定休日: {hd.closedText}</div>}
                  {hd.seasonalNote && <div>季節による変更あり（下記の掲載原文を参照）</div>}
                  {hd.notes && <div style={{ color: 'var(--text-sub)' }}>掲載原文: {hd.notes}</div>}
                  <div style={{ marginTop: 6 }}>
                    駐車場24時間: {hd.parking24h ? '○（道の駅登録要件）' : '要確認'} ／ トイレ24時間:{' '}
                    {hd.toilet24h ? '○（道の駅登録要件）' : '要確認'}
                  </div>
                  <div style={{ color: 'var(--text-sub)', marginTop: 4 }}>
                    情報源: {hd.sourceName}（最終確認 {hd.verifiedAt}）
                  </div>
                </div>
              )}
            </>
          )}
          <div style={{ color: 'var(--text-sub)', fontSize: 12, marginTop: 6 }}>
            通常営業時間に基づく目安です。臨時休業・季節変更は公式情報をご確認ください。
          </div>
        </div>

        {/*
          公開前UX整理: 「周辺を探す」を駅詳細のPRIMARY導線にする。
          ユーザーに「アプリ内検索とGoogle検索のどちらを使うか」を最初に選ばせない。
          このボタンを押して初めて、既存の周辺スポットパネル（食べる/観光/温泉・休憩/
          宿泊/すべてのカテゴリUI）を表示する。
        */}
        <div className="btn-grid">
          <button
            className="btn-primary wide"
            style={{ minHeight: 48, fontSize: 15 }}
            onClick={onSearchNearby}
            data-testid="btn-search-nearby"
          >
            🔍 周辺の観光・グルメ・温泉・宿を探す
          </button>
          {st.status === 'open' && state !== 'visited' && (
            <button className="btn-primary" onClick={() => onSetState(st.id, 'visited')} data-testid="btn-visited">
              ✓ 訪問済みにする
            </button>
          )}
          {st.status === 'open' && state !== 'wishlist' && (
            <button className="btn-warn" onClick={() => onSetState(st.id, 'wishlist')} data-testid="btn-want">
              ★ 行きたいにする
            </button>
          )}
          {st.status === 'open' && state !== 'stamped' && (
            <button className="wide" onClick={() => onSetState(st.id, 'stamped')} data-testid="btn-stamp">
              印 スタンプ取得済みにする
            </button>
          )}
          {st.status === 'open' && state !== 'unvisited' && (
            <button className="wide" onClick={() => onSetState(st.id, 'unvisited')} data-testid="btn-reset">
              未訪問に戻す
            </button>
          )}
          <a
            className="btn-link"
            href={st.officialUrl ?? st.infoUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="link-official"
          >
            公式情報を見る ↗
          </a>
          <a
            className="btn-link"
            href={stationSearchUrl(st)}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="link-gmap"
          >
            Googleマップで開く ↗
          </a>
        </div>
        <p className="msg info" style={{ marginTop: 12 }}>
          営業時間・休館日は変わりやすいため、出発前に公式ページで最新情報を確認してください。
        </p>
        <button style={{ width: '100%', marginTop: 4 }} onClick={onClose} data-testid="sheet-close">
          閉じる
        </button>
      </section>
    </>
  );
}
