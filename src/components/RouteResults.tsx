import { useState } from 'react';
import type { PlannedRoute, Station } from '../types';
import { formatHM, formatMin } from '../lib/geo';
import { directionsUrls } from '../lib/gmaps';

interface Props {
  routes: PlannedRoute[];
  getStation: (id: string) => Station | undefined;
  onSave: (r: PlannedRoute, name: string) => void;
  onStartTrip: (r: PlannedRoute) => void;
  onPreviewOnMap: (r: PlannedRoute) => void;
  onBack: () => void;
}

export function routePoints(r: PlannedRoute, getStation: (id: string) => Station | undefined) {
  const pts = [{ lat: r.params.origin.lat, lng: r.params.origin.lng }];
  for (const s of r.stops) {
    const st = getStation(s.stationId);
    if (st) pts.push({ lat: st.lat, lng: st.lng });
  }
  if (r.params.returnToStart) pts.push({ lat: r.params.origin.lat, lng: r.params.origin.lng });
  return pts;
}

/** 実道路/概算のバッジ */
function RoadDataBadge({ r }: { r: PlannedRoute }) {
  return r.roadData === 'road' ? (
    <span className="badge visited" data-testid="road-badge">
      実道路時間を使用
    </span>
  ) : (
    <span className="badge want" data-testid="road-badge">
      概算時間を使用
    </span>
  );
}

function RoadDataNote({ r }: { r: PlannedRoute }) {
  return (
    <div className="msg warn" data-testid="road-note">
      {r.roadData === 'road'
        ? '実際の道路にもとづく時間ですが、リアルタイムの渋滞は反映していません。出発前にGoogleマップで最新の状況を確認してください。'
        : '所要時間は目安です。実際の経路・渋滞・通行止めはGoogleマップで確認してください。'}
    </div>
  );
}

export function RouteTimeline({
  r,
  getStation,
  progress,
  currentId,
}: {
  r: PlannedRoute;
  getStation: (id: string) => Station | undefined;
  progress?: Record<string, string>;
  currentId?: string | null;
}) {
  const dep = new Date(r.params.departAt);
  return (
    <ol className="timeline" data-testid="route-timeline">
      <li>
        <span className="time">{formatHM(dep)}</span>
        <span>
          <b>{r.params.origin.label}</b> を出発
        </span>
      </li>
      {r.stops.map((s, i) => {
        const st = getStation(s.stationId);
        const leg = r.legs[i];
        const state = progress?.[s.stationId];
        const cls =
          s.stationId === currentId ? 'current' : state === 'done' ? 'done' : state === 'skipped' ? 'skipped' : '';
        return (
          <li key={s.stationId} className={cls}>
            <span className="time">{formatHM(new Date(s.arriveAt))}</span>
            <span>
              <b>
                {i + 1}. 道の駅 {st?.name ?? s.stationId}
              </b>
              <br />
              <span className="leg">
                ← 約{leg.distanceKm}km・{formatMin(leg.driveMin)} ／ 滞在{s.stayMin}分（
                {formatHM(new Date(s.departAt))}発）
              </span>
              {state === 'done' && ' ✓'}
              {state === 'skipped' && '（スキップ）'}
            </span>
          </li>
        );
      })}
      {r.params.returnToStart && (
        <li>
          <span className="time">{formatHM(new Date(r.returnAt))}</span>
          <span>
            <b>{r.params.origin.label}</b> へ帰着
            <br />
            <span className="leg">
              ← 約{r.legs[r.legs.length - 1]?.distanceKm}km・{formatMin(r.legs[r.legs.length - 1]?.driveMin ?? 0)}
            </span>
          </span>
        </li>
      )}
    </ol>
  );
}

export function GmapsButtons({ r, getStation }: { r: PlannedRoute; getStation: (id: string) => Station | undefined }) {
  const [confirming, setConfirming] = useState(false);
  const urls = directionsUrls(routePoints(r, getStation), r.params.roadPref);
  if (!confirming) {
    return (
      <button style={{ width: '100%' }} onClick={() => setConfirming(true)} data-testid="gmaps-open">
        🗺️ Googleマップで全体を確認
      </button>
    );
  }
  return (
    <div className="card" data-testid="gmaps-confirm">
      <div className="msg warn">
        アプリ内の時間は{r.roadData === 'road' ? '渋滞を含まない参考値' : '概算'}です。最新の経路・渋滞はGoogleマップ側で、
        冬季は積雪・凍結・通行止めに、営業時間は各駅の公式サイトでご確認ください。
      </div>
      {urls.map((u, i) => (
        <a key={u} className="btn-link" style={{ marginTop: 8 }} href={u} target="_blank" rel="noopener noreferrer">
          {urls.length > 1 ? `区間${i + 1}／${urls.length} を開く ↗` : 'Googleマップで開く ↗'}
        </a>
      ))}
      {urls.length > 1 && (
        <p className="msg info">経由地が多いため、Googleマップの上限に合わせて区間を分割しています。</p>
      )}
    </div>
  );
}

export default function RouteResults({ routes, getStation, onSave, onStartTrip, onPreviewOnMap, onBack }: Props) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const open = routes.find((r) => r.key === openKey) ?? null;

  if (routes.length === 0) {
    return (
      <div>
        <div className="empty" data-testid="route-empty">
          <p>この条件で回れる道の駅が見つかりませんでした。</p>
          <p style={{ textAlign: 'left' }}>
            こうすると見つかりやすくなります：
            <br />
            ・お出かけ時間を長くする
            <br />
            ・1駅の滞在時間を短くする
            <br />
            ・「県境を越えてOK」にする
            <br />
            ・行きたい県を増やす
          </p>
        </div>
        <button style={{ width: '100%' }} onClick={onBack}>
          ← 条件を変えてみる
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <div>
        {routes.map((r) => (
          <button key={r.key} className="route-card" onClick={() => setOpenKey(r.key)} data-testid={`route-card-${r.key}`}>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 2 }}>
              {formatMin(r.params.budgetMin)}で{r.stops.length}駅回れます
            </div>
            <h3 style={{ margin: '0 0 4px' }}>
              {r.title} <RoadDataBadge r={r} />
            </h3>
            <p className="addr" style={{ margin: '0 0 6px' }}>
              {r.reason}
            </p>
            <div className="route-meta">
              <span>新しく{r.newCount}駅</span>
              {r.wantCount > 0 && <span>★行きたい{r.wantCount}駅</span>}
              <span>移動{formatMin(r.driveMin)}</span>
              <span>滞在{formatMin(r.stayTotalMin)}</span>
              <span>余裕{formatMin(r.marginMin)}</span>
              <span>約{r.totalKm}km</span>
              <span>
                {formatHM(new Date(r.params.departAt))}発 → {formatHM(new Date(r.returnAt))}
                {r.params.returnToStart ? '帰着' : 'ゴール'}
              </span>
            </div>
          </button>
        ))}
        <button style={{ width: '100%' }} onClick={onBack} data-testid="route-back">
          ← 条件を変えてみる
        </button>
      </div>
    );
  }

  return (
    <div data-testid="route-detail">
      <div className="card">
        <div style={{ fontSize: 20, fontWeight: 800 }}>
          {formatMin(open.params.budgetMin)}で{open.stops.length}駅回れます
        </div>
        <h3 style={{ margin: '2px 0 4px' }}>
          {open.title} <RoadDataBadge r={open} />
        </h3>
        <p className="addr">{open.reason}</p>
        <div className="route-meta" style={{ marginBottom: 6 }}>
          <span>出発 {open.params.origin.label}</span>
          <span>{formatHM(new Date(open.params.departAt))} 発</span>
          <span>
            {formatHM(new Date(open.returnAt))} {open.params.returnToStart ? '帰着' : 'ゴール'}
          </span>
          <span>新しく{open.newCount}駅</span>
          {open.wantCount > 0 && <span>★行きたい{open.wantCount}駅</span>}
          <span>移動 {formatMin(open.driveMin)}</span>
          <span>滞在 {formatMin(open.stayTotalMin)}</span>
          <span data-testid="route-margin">安全余裕 {formatMin(open.marginMin)}</span>
          <span data-testid="route-total">
            合計 {formatMin(open.totalMin + open.marginMin)}（設定 {formatMin(open.params.budgetMin)} 以内）
          </span>
          <span>総走行 約{open.totalKm}km</span>
        </div>
        <RouteTimeline r={open} getStation={getStation} />
        <RoadDataNote r={open} />
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        <button className="btn-primary" style={{ minHeight: 52, fontSize: 17 }} onClick={() => onStartTrip(open)} data-testid="trip-start">
          ▶ このコースで出発
        </button>
        <GmapsButtons r={open} getStation={getStation} />
        <button onClick={() => onPreviewOnMap(open)} data-testid="route-preview">
          🗺️ 地図で順番を見る
        </button>
        {saved === open.key ? (
          <button disabled data-testid="route-saved">
            ✓ 保存しました
          </button>
        ) : (
          <button
            onClick={() => {
              onSave(open, `${open.title} ${new Date(open.params.departAt).toLocaleDateString('ja-JP')}`);
              setSaved(open.key);
            }}
            data-testid="route-save"
          >
            💾 このコースを保存
          </button>
        )}
        <button onClick={() => setOpenKey(null)}>← コース一覧に戻る</button>
      </div>
    </div>
  );
}
