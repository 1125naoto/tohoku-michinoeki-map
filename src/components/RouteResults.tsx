import { useState } from 'react';
import StationNearbySearch from './StationNearbySearch';
import type { PlannedRoute, Station } from '../types';
import { formatHM, formatMin } from '../lib/geo';
import { directionsSegments, type RouteMapPoint } from '../lib/gmaps';
import { statusAtArrival, type ArrivalHours } from '../lib/hours';
import { poiDisplayName } from '../lib/poi';
import { computeStayBreakdown } from '../lib/manualRoute';

/** 到着見込みの小さなバッジ */
const ARRIVAL_BADGE: Record<ArrivalHours, { cls: string; text: string }> = {
  open: { cls: 'hopen', text: '営業中' },
  closing: { cls: 'want', text: 'まもなく終了' },
  closed: { cls: 'hclosed', text: '時間外の可能性' },
  unknown: { cls: 'pre', text: '要確認' },
};

/** 予想時間の内訳（Gate7: 移動・道の駅滞在・食事・観光・温泉休憩・安全余裕・帰路・合計） */
export function TimeBreakdownRow({ r }: { r: PlannedRoute }) {
  const b = computeStayBreakdown(r.stops);
  const foodMin = b.restaurant + b.cafe;
  const tourismMin = b.tourism + b.park;
  const returnLeg = r.params.returnToStart ? r.legs[r.legs.length - 1] : null;
  return (
    <div className="route-meta" data-testid="time-breakdown" style={{ marginTop: 6 }}>
      <span>移動 {formatMin(r.driveMin)}</span>
      {b.station > 0 && <span>道の駅滞在 {formatMin(b.station)}</span>}
      {foodMin > 0 && <span>食事 {formatMin(foodMin)}</span>}
      {tourismMin > 0 && <span>観光 {formatMin(tourismMin)}</span>}
      {b.onsen > 0 && <span>温泉・休憩 {formatMin(b.onsen)}</span>}
      {b.lodging > 0 && <span>宿泊 {formatMin(b.lodging)}</span>}
      {b.other > 0 && <span>その他滞在 {formatMin(b.other)}</span>}
      <span data-testid="breakdown-margin">安全余裕 {formatMin(r.marginMin)}</span>
      {returnLeg && <span>帰路 {formatMin(returnLeg.driveMin)}</span>}
      <span data-testid="breakdown-total">合計 {formatMin(r.totalMin + r.marginMin)}</span>
      <span>出発予定 {formatHM(new Date(r.params.departAt))}</span>
      <span data-testid="breakdown-return">
        {r.params.returnToStart ? '帰着予定' : '到着予定'} {formatHM(new Date(r.returnAt))}
      </span>
      <span>総距離 約{r.totalKm}km</span>
      <span data-testid="road-data-summary">
        {r.roadData === 'road'
          ? r.hasUnreachableLeg
            ? '実道路時間を使用（一部区間は概算）'
            : '実道路時間を使用（渋滞は含みません）'
          : '概算時間を使用'}
      </span>
    </div>
  );
}

/** コースカードの営業見込みサマリー */
export function HoursSummaryRow({ r }: { r: PlannedRoute }) {
  const s = r.hoursSummary;
  return (
    <div className="route-meta" data-testid="hours-summary" style={{ marginTop: 2 }}>
      <span>🕒 営業中に到着見込み {s.open + s.closing}駅</span>
      {s.closed > 0 && <span>時間外の可能性 {s.closed}駅</span>}
      {s.unknown > 0 && <span>要確認 {s.unknown}駅</span>}
    </div>
  );
}

interface Props {
  routes: PlannedRoute[];
  getStation: (id: string) => Station | undefined;
  onSave: (r: PlannedRoute, name: string) => void;
  onStartTrip: (r: PlannedRoute) => void;
  onPreviewOnMap: (r: PlannedRoute) => void;
  onBack: () => void;
  /** このコースを取り消す（確認はApp側のダイアログが担当。ここでは要求するだけ） */
  onRequestDiscard: () => void;
  /** ↻ 最初からやり直す（同上） */
  onRequestRestart: () => void;
  /** 「保存」タブから開いた保存済みコースの名前（新規作成の結果ならnull。表示の区別用） */
  viewingSavedName?: string | null;
  /**
   * 自動コース作成の結果（道の駅のみ）に、周辺スポット・自由地点・最終目的地
   * （旅行最後に立ち寄るホテル等）を追加する（「地図から選ぶ」の編集画面へ引き継ぐ）。
   * 未指定 or key==='manual'（既に手動ルート）のときはボタンを表示しない。
   */
  onExtendWithStops?: (r: PlannedRoute) => void;
}

/**
 * Googleマップへ渡す経路上の地点列。道の駅は名称+住所のテキスト検索(query)を使う
 * （生の座標だけだと、Googleマップ側がその座標に最も近い無関係な別のPOI・
 * 駐車場の一区画等を地点名として表示・履歴記録することがあるため。実機不具合の
 * 根本原因。§lib/gmaps.ts RouteMapPoint.queryのコメント参照）。
 * 周辺スポット・自由地点・出発地点は確実な公式住所を持たないため、生の座標のまま。
 */
export function routePoints(r: PlannedRoute, getStation: (id: string) => Station | undefined): RouteMapPoint[] {
  const pts: RouteMapPoint[] = [
    { lat: r.params.origin.lat, lng: r.params.origin.lng, label: r.params.origin.label },
  ];
  for (const s of r.stops) {
    const stopType = s.stopType ?? 'station';
    if (stopType === 'station') {
      const st = getStation(s.stationId);
      if (st) {
        pts.push({
          lat: st.lat,
          lng: st.lng,
          label: `道の駅 ${st.name}`,
          query: `道の駅${st.name} ${st.address}`,
        });
      }
      continue;
    }
    if (stopType === 'custom' && s.custom) {
      pts.push({ lat: s.custom.lat, lng: s.custom.lng, label: s.custom.name ?? s.custom.address });
      continue;
    }
    if (s.poi) pts.push({ lat: s.poi.lat, lng: s.poi.lng, label: poiDisplayName(s.poi) });
  }
  if (r.params.returnToStart) {
    pts.push({ lat: r.params.origin.lat, lng: r.params.origin.lng, label: r.params.origin.label });
  }
  return pts;
}

/** 停留地点の表示名（道の駅は「道の駅◯◯」、周辺スポット・自由地点はそのまま名称） */
function stopDisplayName(s: PlannedRoute['stops'][number], getStation: (id: string) => Station | undefined): string {
  const stopType = s.stopType ?? 'station';
  if (stopType === 'station') {
    const st = getStation(s.stationId);
    return `道の駅 ${st?.name ?? s.stationId}`;
  }
  if (stopType === 'custom' && s.custom) {
    return s.custom.name ?? s.custom.address;
  }
  return s.poi ? poiDisplayName(s.poi) : s.stationId;
}

/** 実道路/概算のバッジ */
function RoadDataBadge({ r }: { r: PlannedRoute }) {
  if (r.roadData === 'road' && r.hasUnreachableLeg) {
    return (
      <span className="badge want" data-testid="road-badge">
        実道路時間（一部概算）
      </span>
    );
  }
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
      {r.roadData === 'road' && r.hasUnreachableLeg && (
        <>
          <br />
          ⚠️ 一部区間は実道路データ上、自動車での接続が確認できませんでした（下記のタイムラインで
          ⚠️ マークが付いた区間）。その区間のみ概算値です。実際に走行可能か出発前に必ずご確認ください。
        </>
      )}
      <br />
      営業の見込みは通常営業時間に基づく目安です。臨時休業・季節変更は公式情報をご確認ください。
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
        const leg = r.legs[i];
        const state = progress?.[s.stationId];
        const cls =
          s.stationId === currentId ? 'current' : state === 'done' ? 'done' : state === 'skipped' ? 'skipped' : '';
        const isStation = (s.stopType ?? 'station') === 'station';
        const arrival = isStation ? ARRIVAL_BADGE[statusAtArrival(s.stationId, new Date(s.arriveAt))] : null;
        return (
          <li key={s.stationId} className={cls}>
            <span className="time">{formatHM(new Date(s.arriveAt))}</span>
            <span>
              <b>
                {i + 1}. {stopDisplayName(s, getStation)}
              </b>{' '}
              {arrival && (
                <span className={`badge ${arrival.cls}`} style={{ fontSize: 11 }}>
                  {arrival.text}
                </span>
              )}
              {!isStation && (
                <span className="badge pre" style={{ fontSize: 11 }} data-testid="stop-type-badge">
                  {(s.stopType ?? 'station') === 'custom' ? '自由地点' : '周辺スポット'}
                </span>
              )}
              <br />
              <span className="leg" data-testid={leg.unreachable ? 'route-leg-unreachable' : undefined}>
                ← 約{leg.distanceKm}km・{formatMin(leg.driveMin)} ／ 滞在{s.stayMin}分（
                {formatHM(new Date(s.departAt))}発）
                {leg.unreachable && (
                  <span className="badge want" style={{ fontSize: 11, marginLeft: 4 }}>
                    ⚠️ 実道路接続なし・概算
                  </span>
                )}
              </span>
              {state === 'done' && ' ✓'}
              {state === 'skipped' && '（スキップ）'}
              {/* コースに入っている道の駅から、その市区町村のカテゴリ検索を開けるようにする */}
              {isStation &&
                (() => {
                  const st = getStation(s.stationId);
                  return st ? <StationNearbySearch station={st} testIdPrefix={`stop-${s.stationId}`} /> : null;
                })()}
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
            <span className="leg" data-testid={r.legs[r.legs.length - 1]?.unreachable ? 'route-leg-unreachable' : undefined}>
              ← 約{r.legs[r.legs.length - 1]?.distanceKm}km・{formatMin(r.legs[r.legs.length - 1]?.driveMin ?? 0)}
              {r.legs[r.legs.length - 1]?.unreachable && (
                <span className="badge want" style={{ fontSize: 11, marginLeft: 4 }}>
                  ⚠️ 実道路接続なし・概算
                </span>
              )}
            </span>
          </span>
        </li>
      )}
    </ol>
  );
}

export function GmapsButtons({ r, getStation }: { r: PlannedRoute; getStation: (id: string) => Station | undefined }) {
  const [confirming, setConfirming] = useState(false);
  const segments = directionsSegments(routePoints(r, getStation), r.params.roadPref);
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
      {segments.length > 1 && (
        <p className="msg info" data-testid="gmaps-segment-note">
          経由地が多いため、Googleマップの上限に合わせて{segments.length}つのルートに分けています。
          <br />
          ひとつ目のルートの目的地に着いたら、この画面に戻って次のルートを開いてください。
        </p>
      )}
      {segments.map((seg) => {
        const segTitle = seg.index === 1 ? '最初のルート' : seg.index === segments.length ? '最後のルート' : `${seg.index}つ目のルート`;
        return (
          <div key={seg.url} className="note-box" style={{ marginTop: 8 }} data-testid="gmaps-segment">
            {segments.length > 1 && (
              <div style={{ fontWeight: 700, marginBottom: 4 }} data-testid="gmaps-segment-label">
                {seg.index}／{seg.total}　{segTitle}
                <br />
                <span style={{ fontWeight: 400, fontSize: 13 }}>
                  {seg.fromLabel} → {seg.toLabel}
                </span>
              </div>
            )}
            <a className="btn-link" href={seg.url} target="_blank" rel="noopener noreferrer" data-testid="gmaps-segment-link">
              {segments.length > 1 ? `Googleマップで${segTitle}を開く ↗` : 'Googleマップで開く ↗'}
            </a>
          </div>
        );
      })}
    </div>
  );
}

export default function RouteResults({
  routes,
  getStation,
  onSave,
  onStartTrip,
  onPreviewOnMap,
  onBack,
  onRequestDiscard,
  onRequestRestart,
  viewingSavedName,
  onExtendWithStops,
}: Props) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const open = routes.find((r) => r.key === openKey) ?? null;
  const savedBadge = viewingSavedName && (
    <p className="msg info" data-testid="viewing-saved-badge" style={{ marginBottom: 8 }}>
      📖 保存済みのコース「{viewingSavedName}」を表示中です
    </p>
  );

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
        <button style={{ width: '100%', marginTop: 8 }} onClick={onRequestRestart} data-testid="route-restart">
          ↻ 最初からやり直す
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <div>
        {savedBadge}
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
            <HoursSummaryRow r={r} />
          </button>
        ))}
        <button style={{ width: '100%' }} onClick={onBack} data-testid="route-back">
          ← 条件を変えてみる
        </button>
        <div className="btn-grid" style={{ marginTop: 8 }}>
          <button onClick={onRequestDiscard} data-testid="route-discard">
            ❌ このコースを取り消す
          </button>
          <button onClick={onRequestRestart} data-testid="route-restart">
            ↻ 最初からやり直す
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="route-detail">
      {savedBadge}
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
        <HoursSummaryRow r={open} />
        <h3 style={{ marginTop: 10, fontSize: 14 }}>予想時間の内訳</h3>
        <TimeBreakdownRow r={open} />
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
        {onExtendWithStops && open.key !== 'manual' && (
          <button onClick={() => onExtendWithStops(open)} data-testid="route-extend-with-stops">
            🍴🏨 食事・観光・ホテル等を追加する
          </button>
        )}
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
        <button onClick={() => setOpenKey(null)} data-testid="route-detail-back">
          ← コース一覧に戻る
        </button>
        <button onClick={onBack} data-testid="route-edit">
          ✏️ 立ち寄り先・順番・時間・道路の希望を変更する
        </button>
        <div className="btn-grid">
          <button onClick={onRequestDiscard} data-testid="route-discard">
            ❌ このコースを取り消す
          </button>
          <button onClick={onRequestRestart} data-testid="route-restart">
            ↻ 最初からやり直す
          </button>
        </div>
      </div>
    </div>
  );
}
