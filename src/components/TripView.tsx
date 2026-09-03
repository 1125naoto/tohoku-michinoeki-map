import { useMemo, useState } from 'react';
import type { SavedRoute, Station, StopProgress, TripState, VisitMap } from '../types';
import { formatHM, formatMin } from '../lib/geo';
import { RouteTimeline } from './RouteResults';

interface Props {
  saved: SavedRoute;
  trip: TripState;
  visits: VisitMap;
  getStation: (id: string) => Station | undefined;
  onProgress: (stationId: string, p: StopProgress) => void;
  /** 到着した: visited(赤)にして次へ */
  onArrived: (stationId: string) => void;
  /** スタンプ取得: stamped(紫)にして次へ */
  onStamp: (stationId: string) => void;
  onFinish: (visitedIds: string[], stampIds: string[]) => void;
  onShowMap: () => void;
  onExit: () => void;
  /** Googleマップで次の駅へ（中間画面なしで直接開く） */
  onNavToStation: (st: Station) => void;
  /** 帰路ナビ（出発地点へ） */
  onNavHome: () => void;
}

export default function TripView({
  saved,
  trip,
  visits,
  getStation,
  onProgress,
  onArrived,
  onStamp,
  onFinish,
  onShowMap,
  onExit,
  onNavToStation,
  onNavHome,
}: Props) {
  const r = saved.route;
  const [finishing, setFinishing] = useState(false);
  const [checkedVisit, setCheckedVisit] = useState<Record<string, boolean>>({});
  const [checkedStamp, setCheckedStamp] = useState<Record<string, boolean>>({});

  const doneCount = r.stops.filter((s) => {
    const p = trip.progress[s.stationId];
    return p === 'done' || p === 'skipped';
  }).length;
  const currentStop = useMemo(
    () =>
      r.stops.find((s) => {
        const p = trip.progress[s.stationId];
        return p !== 'done' && p !== 'skipped';
      }) ?? null,
    [r.stops, trip.progress],
  );
  const currentIdx = currentStop ? r.stops.indexOf(currentStop) : -1;
  const remainMin = Math.max(0, Math.round((new Date(r.returnAt).getTime() - Date.now()) / 60000));
  const cur = currentStop ? getStation(currentStop.stationId) : null;
  const curLeg = currentIdx >= 0 ? r.legs[currentIdx] : null;
  const allDone = currentStop === null;

  if (finishing || (allDone && !r.params.returnToStart)) {
    // 終了: 実際に訪問できた駅を確認して一括反映
    return (
      <div data-testid="trip-finish">
        <div className="card">
          <h3>おつかれさまでした！記録を確認</h3>
          <p className="msg info">チェックした駅を「訪問済み」（印は「スタンプ取得済み」）として記録します。</p>
          {r.stops.map((s) => {
            const st = getStation(s.stationId);
            const done = trip.progress[s.stationId] === 'done';
            const stState = visits[s.stationId]?.state;
            const already = stState === 'visited' || stState === 'stamped';
            return (
              <div
                key={s.stationId}
                style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '8px 0', borderBottom: '1px dashed var(--border)' }}
              >
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
                    checked={checkedStamp[s.stationId] ?? stState === 'stamped'}
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
                .filter(
                  (id) =>
                    checkedVisit[id] ??
                    (trip.progress[id] === 'done' ||
                      visits[id]?.state === 'visited' ||
                      visits[id]?.state === 'stamped'),
                );
              const stampIds = r.stops
                .map((s) => s.stationId)
                .filter((id) => checkedStamp[id] ?? visits[id]?.state === 'stamped');
              onFinish(visitIds, stampIds);
            }}
          >
            記録してコースを終了
          </button>
          <button style={{ width: '100%', marginTop: 8 }} onClick={onExit}>
            記録せずに閉じる
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="trip-view">
      <div className="card" style={{ paddingBottom: 8 }}>
        <h3 style={{ marginBottom: 6 }}>{saved.name}</h3>
        <div className="trip-stats">
          <span>
            進行
            <br />
            <b data-testid="trip-progress">
              {doneCount}／{r.stops.length}駅
            </b>
          </span>
          <span>
            残り時間
            <br />
            <b data-testid="trip-remaining-time">{formatMin(remainMin)}</b>
          </span>
          <span>
            帰着予定
            <br />
            <b>{formatHM(new Date(r.returnAt))}</b>
          </span>
        </div>
      </div>

      {cur && currentStop && curLeg && (
        <div className="trip-next">
          <div className="label">次の道の駅（{currentIdx + 1}／{r.stops.length}）</div>
          <h3 data-testid="trip-current">道の駅 {cur.name}</h3>
          <p className="addr">
            約{curLeg.distanceKm}km・{formatMin(curLeg.driveMin)} ／ {formatHM(new Date(currentStop.arriveAt))}
            ごろ到着予定 ／ 滞在{currentStop.stayMin}分
          </p>
          <div className="btn-grid">
            <button
              className="btn-primary wide"
              style={{ minHeight: 56, fontSize: 17 }}
              onClick={() => onNavToStation(cur)}
              data-testid="trip-nav"
            >
              🧭 Googleマップで次の駅へ
            </button>
            <button
              className="btn-primary"
              onClick={() => {
                onArrived(cur.id);
                onProgress(cur.id, 'done');
              }}
              data-testid="trip-arrived"
            >
              ✓ 到着した
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
              この駅をスキップ（記録は変えない）
            </button>
          </div>
          <p className="msg info" style={{ marginBottom: 0 }}>
            🚗 安全な場所に停車して操作してください。
          </p>
        </div>
      )}

      {allDone && r.params.returnToStart && (
        <div className="trip-next" data-testid="trip-return">
          <div className="label">全駅まわりました！</div>
          <h3>出発地点（{r.params.origin.label}）へ帰りましょう</h3>
          <p className="addr">帰着予定 {formatHM(new Date(r.returnAt))}ごろ</p>
          <div className="btn-grid">
            <button
              className="btn-primary wide"
              style={{ minHeight: 56, fontSize: 17 }}
              onClick={onNavHome}
              data-testid="trip-nav-home"
            >
              🧭 Googleマップで出発地点へ戻る
            </button>
            <button className="wide" onClick={() => setFinishing(true)} data-testid="trip-finish-btn">
              🏁 コースを終了する
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
        {!allDone && (
          <button onClick={() => setFinishing(true)} data-testid="trip-finish-btn">
            🏁 コースを終了する（記録を確認）
          </button>
        )}
        <button onClick={onExit} data-testid="trip-suspend">
          ⏸ コースを中断（あとで再開できます）
        </button>
      </div>
    </div>
  );
}
