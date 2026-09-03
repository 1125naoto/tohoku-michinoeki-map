import { useState } from 'react';
import type { SavedRoute, Station } from '../types';
import { formatHM, formatMin } from '../lib/geo';
import ConfirmDialog from './ConfirmDialog';
import { DATA_META } from '../data';

interface Props {
  routes: SavedRoute[];
  getStation: (id: string) => Station | undefined;
  onOpen: (r: SavedRoute) => void;
  onDuplicate: (r: SavedRoute) => void;
  onRecalc: (r: SavedRoute) => void;
  onDelete: (id: string) => void;
  onResetAll: () => void;
  onShowInstallHint: () => void;
}

export default function SavedRoutesView({
  routes,
  getStation,
  onOpen,
  onDuplicate,
  onRecalc,
  onDelete,
  onResetAll,
  onShowInstallHint,
}: Props) {
  const [deleting, setDeleting] = useState<SavedRoute | null>(null);
  const [resetting, setResetting] = useState(false);

  return (
    <div>
      <h3 style={{ margin: '4px 0 10px' }}>保存したルート</h3>
      {routes.length === 0 && (
        <div className="empty" data-testid="saved-empty">
          保存済みのルートはまだありません。
          <br />
          「ルート」タブで週末ルートを作って保存できます。
        </div>
      )}
      {routes.map((sr) => (
        <div key={sr.id} className="route-card" data-testid="saved-route">
          <h3>
            {sr.name}
            {sr.done && <span className="badge visited">完了</span>}
          </h3>
          <div className="route-meta">
            <span>作成 {new Date(sr.createdAt).toLocaleDateString('ja-JP')}</span>
            <span>{sr.route.stops.length}駅</span>
            <span>約{sr.route.totalKm}km</span>
            <span>{formatMin(sr.route.totalMin)}</span>
            <span>
              {formatHM(new Date(sr.route.params.departAt))}発 {sr.route.params.origin.label}
            </span>
          </div>
          <p className="addr" style={{ margin: '6px 0' }}>
            {sr.route.stops.map((s) => getStation(s.stationId)?.name ?? '?').join(' → ')}
          </p>
          <div className="btn-grid">
            <button className="btn-primary" onClick={() => onOpen(sr)} data-testid="saved-open">
              再表示
            </button>
            <button onClick={() => onDuplicate(sr)}>複製</button>
            <button onClick={() => onRecalc(sr)}>再計算</button>
            <button className="btn-danger-ghost" onClick={() => setDeleting(sr)} data-testid="saved-delete">
              削除
            </button>
          </div>
        </div>
      ))}

      <div className="card" style={{ marginTop: 24 }}>
        <h3>アプリとして使う</h3>
        <button style={{ width: '100%' }} onClick={onShowInstallHint} data-testid="show-a2hs">
          📲 ホーム画面への追加方法を見る
        </button>
      </div>

      <div className="card">
        <h3>データ管理</h3>
        <p className="msg info">
          訪問記録・スタンプ・保存ルートはこの端末のブラウザ内（localStorage）にのみ保存されます。
        </p>
        <button className="btn-danger-ghost" style={{ width: '100%' }} onClick={() => setResetting(true)} data-testid="reset-all">
          すべての記録を初期化する
        </button>
      </div>

      <div className="card">
        <h3>収録データについて</h3>
        <p className="msg info" style={{ margin: 0 }}>
          国土交通省登録 {DATA_META.registrationCount}駅／収録 {DATA_META.facilityCount}施設（データ確認日 {DATA_META.verifiedAt}）。
          営業時間・休館日は収録していません。出発前に各駅の公式ページで最新情報を確認してください。
        </p>
      </div>

      {deleting && (
        <ConfirmDialog
          title="ルートを削除"
          message={`「${deleting.name}」を削除します。この操作は取り消せません。`}
          confirmLabel="削除する"
          danger
          onConfirm={() => {
            onDelete(deleting.id);
            setDeleting(null);
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
      {resetting && (
        <ConfirmDialog
          title="全記録の初期化"
          message="訪問記録・スタンプ記録・保存ルートをすべて削除します。この操作は取り消せません。本当に初期化しますか？"
          confirmLabel="初期化する"
          danger
          onConfirm={() => {
            onResetAll();
            setResetting(false);
          }}
          onCancel={() => setResetting(false)}
        />
      )}
    </div>
  );
}
