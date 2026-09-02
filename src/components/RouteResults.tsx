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

export function RouteSummaryCard({ r, onOpen }: { r: PlannedRoute; onOpen: () => void }) {
  return (
    <button className="route-card" onClick={onOpen} data-testid={`route-card-${r.key}`}>
      <h3>
        {r.title}（{r.stops.length}駅）
      </h3>
      <div className="route-meta">
        <span>使用 {formatMin(r.totalMin)}</span>
        <span>約 {r.totalKm}km</span>
        <span>新規制覇 {r.newCount}駅</span>
        <span>帰着 {formatHM(new Date(r.returnAt))}</span>
      </div>
    </button>
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
          s.stationId === currentId
            ? 'current'
            : state === 'done'
              ? 'done'
              : state === 'skipped'
                ? 'skipped'
                : '';
        return (
          <li key={s.stationId} className={cls}>
            <span className="time">{formatHM(new Date(s.arriveAt))}</span>
            <span>
              <b>道の駅 {st?.name ?? s.stationId}</b>
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
  const urls = directionsUrls(routePoints(r, getStation));
  if (!confirming) {
    return (
      <button className="btn-primary" style={{ width: '100%' }} onClick={() => setConfirming(true)} data-testid="gmaps-open">
        Googleマップでルートを開く
      </button>
    );
  }
  return (
    <div className="card" data-testid="gmaps-confirm">
      <div className="msg warn">
        ・アプリ内の所要時間は概算です
        <br />
        ・最新の経路・渋滞はGoogleマップ側で確認してください
        <br />
        ・冬季は積雪・凍結・通行止めに注意してください
        <br />
        ・各道の駅の営業時間は公式サイトで確認してください
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
          <p>条件に合う候補駅が見つかりませんでした。</p>
          <p>使用可能時間を増やす、対象県を広げる、「すべて」を対象にする等をお試しください。</p>
        </div>
        <button style={{ width: '100%' }} onClick={onBack}>
          ← 条件を変更する
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <div>
        <p className="msg info">
          最大3種類のコースを提案します。タップして詳細を確認してください。所要時間は概算です。
        </p>
        {routes.map((r) => (
          <RouteSummaryCard key={r.key} r={r} onOpen={() => setOpenKey(r.key)} />
        ))}
        <button style={{ width: '100%' }} onClick={onBack} data-testid="route-back">
          ← 条件を変更する
        </button>
      </div>
    );
  }

  return (
    <div data-testid="route-detail">
      <div className="card">
        <h3>
          {open.title}（{formatMin(open.params.budgetMin)}設定・{open.stops.length}駅）
        </h3>
        <div className="route-meta" style={{ marginBottom: 6 }}>
          <span>出発 {open.params.origin.label}</span>
          <span>{formatHM(new Date(open.params.departAt))} 発</span>
          <span>{formatHM(new Date(open.returnAt))} {open.params.returnToStart ? '帰着' : '最終駅発'}</span>
          <span>使用予定 {formatMin(open.totalMin)}</span>
          <span>総走行 約{open.totalKm}km</span>
          <span>新規制覇 {open.newCount}駅</span>
        </div>
        <RouteTimeline r={open} getStation={getStation} />
        <div className="msg warn">
          所要時間は目安です。実際の渋滞、積雪、通行止め、道路状況、営業時間はGoogleマップと公式サイトで確認してください。
        </div>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        <GmapsButtons r={open} getStation={getStation} />
        <button onClick={() => onPreviewOnMap(open)}>🗺️ 地図でルートを見る</button>
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
            💾 このルートを保存
          </button>
        )}
        <button className="btn-primary" onClick={() => onStartTrip(open)} data-testid="trip-start">
          ▶ この計画で出発（旅行中画面へ）
        </button>
        <button onClick={() => setOpenKey(null)}>← コース一覧に戻る</button>
      </div>
    </div>
  );
}
