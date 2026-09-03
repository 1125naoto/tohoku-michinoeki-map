import type { Station, StationState, VisitMap } from '../types';
import { stationSearchUrl } from '../lib/gmaps';

interface Props {
  station: Station;
  visits: VisitMap;
  onSetState: (id: string, state: StationState) => void;
  onClose: () => void;
}

const STATION_STATUS_LABEL: Record<string, string> = {
  open: '営業中',
  pre_open: '登録済み・開業前',
  closed_temp: '一時休業',
  unknown: '状態未確認',
};

export default function StationSheet({ station: st, visits, onSetState, onClose }: Props) {
  const state = visits[st.id]?.state ?? 'unvisited';
  const rec = visits[st.id];

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
        {st.note && <div className="note-box">ℹ️ {st.note}</div>}
        {st.status === 'pre_open' && (
          <div className="note-box">この駅は開業前のため、状態変更とルート提案の対象外です。</div>
        )}

        <div className="btn-grid">
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
          💡 地図のマーカーは押すたびに 未訪問→訪問済み→行きたい→スタンプ取得済み→未訪問 の順で切り替わります。
          <br />
          営業時間・休館日は変わりやすいため、出発前に公式ページで最新情報を確認してください。
        </p>
        <button style={{ width: '100%', marginTop: 4 }} onClick={onClose} data-testid="sheet-close">
          閉じる
        </button>
      </section>
    </>
  );
}
