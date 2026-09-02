import { useMemo, useState } from 'react';
import type { SavedRoute, Station, StopProgress, TripState, VisitMap } from '../types';
import { formatHM, formatMin } from '../lib/geo';
import { stationSearchUrl } from '../lib/gmaps';
import { RouteTimeline } from './RouteResults';

interface Props {
  saved: SavedRoute;
  trip: TripState;
  visits: VisitMap;
  getStation: (id: string) => Station | undefined;
  onProgress: (stationId: string, p: StopProgress) => void;
  onVisit: (stationId: string) => void;
  onStamp: (stationId: string) => void;
  onFinish: (visitedIds: string[], stampIds: string[]) => void;
  onShowMap: () => void;
  onExit: () => void;
}

export default function TripView({
  saved,
  trip,
  visits,
  getStation,
  onProgress,
  onVisit,
  onStamp,
  onFinish,
  onShowMap,
  onExit,
}: Props) {
  const r = saved.route;
  const [finishing, setFinishing] = useState(false);
  const [checkedVisit, setCheckedVisit] = useState<Record<string, boolean>>({});
  const [checkedStamp, setCheckedStamp] = useState<Record<string, boolean>>({});

  const currentStop = useMemo(
    () => r.stops.find((s) => {
      const p = trip.progress[s.stationId];
      return p !== 'done' && p !== 'skipped';
    }) ?? null,
    [r.stops, trip.progress],
  );
  const remaining = r.stops.filter((s) => {
    const p = trip.progress[s.stationId];
    return p !== 'done' && p !== 'skipped';
  }).length;
  const nextStop = currentStop
    ? r.stops[r.stops.indexOf(currentStop) + 1] ?? null
    : null;
  const remainMin = Math.max(0, Math.round((new Date(r.returnAt).getTime() - Date.now()) / 60000));
  const cur = currentStop ? getStation(currentStop.stationId) : null;
  const curProgress = currentStop ? trip.progress[currentStop.stationId] : null;

  if (finishing || (!currentStop && !finishing)) {
    // ルート終了: 実際に訪問できた駅を選択して一括反映
    return (
      <div data-testid="trip-finish">
        <div className="card">
          <h3>おつかれさまでした！訪問できた駅を反映</h3>
          <p className="msg info">
            チェックした駅を「訪問済み」「スタンプ取得」として一括記録します（ルートに含まれただけでは自動記録されません）。
          </p>
          {r.stops.map((s) => {
            const st = getStation(s.stationId);
            const done = trip.progress[s.stationId] === 'done';
            const already = visits[s.stationId]?.status === 'visited';
            return (
              <div key={s.stationId} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '8px 0', borderBottom: '1px dashed var(--border)' }}>
                <label style={{ flex: 1, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    style={{ minHeight: 22, width: 22 }}
                    checked={checkedVisit[s.stationId] ?? (done || already)}
                    onChange={(e) => setCheckedVisit({ ...checkedVisit, [s.stationId]: e.target.checked })}
                  />
                  <span>
                    道の駅 {st?.name}
                    {already && <span className="badge visited">済</span>}
                  </span>
                </label>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    style={{ minHeight: 22, width: 22 }}
                    checked={checkedStamp[s.stationId] ?? visits[s.stationId]?.stamp ?? false}
                    onChange={(e) => setCheckedStamp({ ...checkedStamp, [s.stationId]: e.target.checked })}
                  />
                  印
                </label>
              </div>
            );
          })}
          <button
            className="btn-primary"
            style={{ width: '100%', marginTop: 12 }}
            data-testid="trip-apply"
            onClick={() => {
              const visitIds = r.stops
                .map((s) => s.stationId)
                .filter((id) => checkedVisit[id] ?? (trip.progress[id] === 'done' || visits[id]?.status === 'visited'));
              const stampIds = r.stops
                .map((s) => s.stationId)
                .filter((id) => checkedStamp[id] ?? visits[id]?.stamp ?? false);
              onFinish(visitIds, stampIds);
            }}
          >
            一括反映してルートを終了
          </button>
          <button style={{ width: '100%', marginTop: 8 }} onClick={onExit}>
            反映せずに閉じる
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="trip-view">
      <div className="trip-stats">
        <span>
          残り時間
          <br />
          <b data-testid="trip-remaining-time">{formatMin(remainMin)}</b>
        </span>
        <span>
          残り立ち寄り
          <br />
          <b data-testid="trip-remaining-stops">{remaining}駅</b>
        </span>
        <span>
          帰着予定
          <br />
          <b>{formatHM(new Date(r.returnAt))}</b>
        </span>
      </div>

      {cur && currentStop && (
        <div className="trip-next">
          <div className="label">現在の目的地（{formatHM(new Date(currentStop.arriveAt))} 着予定）</div>
          <h3 data-testid="trip-current">道の駅 {cur.name}</h3>
          <p className="addr">
            {cur.pref} {cur.city}・滞在予定 {currentStop.stayMin}分
          </p>
          {nextStop && (
            <p className="addr">
              次の道の駅: {getStation(nextStop.stationId)?.name ?? '—'}（{formatHM(new Date(nextStop.arriveAt))} 着予定）
            </p>
          )}
          <div className="btn-grid">
            <a
              className="btn-link btn-primary wide"
              href={stationSearchUrl(cur)}
              target="_blank"
              rel="noopener noreferrer"
            >
              🧭 Googleマップでナビ ↗
            </a>
            {curProgress !== 'arrived' ? (
              <button className="wide" onClick={() => onProgress(cur.id, 'arrived')} data-testid="trip-arrived">
                📍 到着した
              </button>
            ) : (
              <div className="msg info wide" style={{ margin: 0, textAlign: 'center' }}>
                到着済み
              </div>
            )}
            <button
              className="btn-primary"
              onClick={() => {
                onVisit(cur.id);
                onProgress(cur.id, 'done');
              }}
              data-testid="trip-visited"
            >
              ✓ 訪問完了
            </button>
            <button
              onClick={() => {
                onStamp(cur.id);
                onProgress(cur.id, 'done');
              }}
              data-testid="trip-stamp"
            >
              印 スタンプ取得
            </button>
            <button className="wide" onClick={() => onProgress(cur.id, 'skipped')} data-testid="trip-skip">
              この駅をスキップ
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <h3>行程表</h3>
        <RouteTimeline r={r} getStation={getStation} progress={trip.progress} currentId={cur?.id ?? null} />
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        <button onClick={onShowMap}>🗺️ 地図でルートを見る</button>
        <button onClick={() => setFinishing(true)} data-testid="trip-finish-btn">
          🏁 ルートを終了する（訪問を一括反映）
        </button>
        <button onClick={onExit}>いったん閉じる（後で再開できます）</button>
      </div>
    </div>
  );
}
