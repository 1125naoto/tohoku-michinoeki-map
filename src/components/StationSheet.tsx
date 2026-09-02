import type { Station, VisitMap, VisitStatus } from '../types';
import { stationSearchUrl } from '../lib/gmaps';

interface Props {
  station: Station;
  visits: VisitMap;
  onSetStatus: (id: string, status: VisitStatus) => void;
  onSetStamp: (id: string, stamp: boolean) => void;
  onClose: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  open: '営業中',
  pre_open: '登録済み・開業前',
  closed_temp: '一時休業',
  unknown: '状態未確認',
};

export default function StationSheet({ station: st, visits, onSetStatus, onSetStamp, onClose }: Props) {
  const rec = visits[st.id];
  const status = rec?.status ?? 'none';
  const stamp = rec?.stamp ?? false;

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} data-testid="sheet-backdrop" />
      <section className="sheet" data-testid="station-sheet" aria-label={`道の駅${st.name}の詳細`}>
        <div className="sheet-grip" />
        <h2>道の駅 {st.name}</h2>
        {st.kana && <p className="kana">{st.kana}</p>}
        <p className="addr">
          {st.pref} {st.city}
        </p>
        <p className="addr">{st.address}</p>
        <p style={{ margin: '6px 0' }}>
          {st.status !== 'open' && <span className="badge pre">{STATUS_LABEL[st.status]}</span>}
          {st.status === 'open' && status === 'none' && <span className="badge none">● 未訪問</span>}
          {status === 'want' && <span className="badge want">★ 行きたい</span>}
          {status === 'visited' && <span className="badge visited">✓ 訪問済み</span>}
          {stamp && <span className="badge stamp">印 スタンプ取得済み</span>}
        </p>
        {rec?.visitedAt && (
          <p className="addr">訪問日: {new Date(rec.visitedAt).toLocaleDateString('ja-JP')}</p>
        )}
        {st.note && <div className="note-box">ℹ️ {st.note}</div>}
        {st.status === 'pre_open' && (
          <div className="note-box">この駅は開業前のため、ルート提案の対象外です。</div>
        )}

        <div className="btn-grid">
          {st.status === 'open' && status !== 'visited' && (
            <button className="btn-primary wide" onClick={() => onSetStatus(st.id, 'visited')} data-testid="btn-visited">
              ✓ 訪問済みにする
            </button>
          )}
          {st.status === 'open' && status === 'none' && (
            <button className="btn-warn wide" onClick={() => onSetStatus(st.id, 'want')} data-testid="btn-want">
              ★ 行きたいにする
            </button>
          )}
          {st.status === 'open' && status === 'want' && (
            <button className="btn-warn wide" onClick={() => onSetStatus(st.id, 'none')} data-testid="btn-unwant">
              ★ 行きたいを解除
            </button>
          )}
          {st.status === 'open' && !stamp && (
            <button className="wide" onClick={() => onSetStamp(st.id, true)} data-testid="btn-stamp">
              印 スタンプ取得を記録
            </button>
          )}
          {stamp && (
            <button className="wide" onClick={() => onSetStamp(st.id, false)} data-testid="btn-unstamp">
              スタンプ記録を取り消す
            </button>
          )}
          {status === 'visited' && (
            <button className="wide" onClick={() => onSetStatus(st.id, 'none')} data-testid="btn-reset">
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
