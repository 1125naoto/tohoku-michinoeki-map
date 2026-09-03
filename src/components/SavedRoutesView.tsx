import { useRef, useState } from 'react';
import type { SavedRoute, Station } from '../types';
import { formatHM, formatMin } from '../lib/geo';
import ConfirmDialog from './ConfirmDialog';
import { DATA_META } from '../data';
import type { BackupFile, ParseResult, RestoreMode } from '../lib/backup';

interface Props {
  routes: SavedRoute[];
  getStation: (id: string) => Station | undefined;
  onOpen: (r: SavedRoute) => void;
  onDuplicate: (r: SavedRoute) => void;
  onRecalc: (r: SavedRoute) => void;
  onDelete: (id: string) => void;
  onResetAll: () => void;
  onShowInstallHint: () => void;
  onExportBackup: () => void;
  onReadBackupFile: (file: File) => Promise<ParseResult>;
  onApplyRestore: (data: BackupFile, mode: RestoreMode) => void;
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
  onExportBackup,
  onReadBackupFile,
  onApplyRestore,
}: Props) {
  const [deleting, setDeleting] = useState<SavedRoute | null>(null);
  const [resetting, setResetting] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<BackupFile | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreDone, setRestoreDone] = useState<RestoreMode | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFilePicked = async (file: File) => {
    setRestoreError(null);
    setRestoreDone(null);
    const result = await onReadBackupFile(file);
    if (!result.ok) {
      setRestoreError(result.error);
      return;
    }
    setPendingRestore(result.data);
  };

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
          機種変更やブラウザの変更に備えて、バックアップファイルを保存しておくことをおすすめします。
        </p>
        <div className="btn-grid">
          <button onClick={onExportBackup} data-testid="backup-export">
            💾 記録をバックアップ
          </button>
          <button onClick={() => fileInputRef.current?.click()} data-testid="backup-import">
            📂 バックアップを復元
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          data-testid="backup-file-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void handleFilePicked(file);
          }}
        />
        {restoreError && (
          <p className="msg error" data-testid="backup-error" style={{ marginTop: 8 }}>
            復元できませんでした：{restoreError}
          </p>
        )}
        {restoreDone && (
          <p className="msg info" data-testid="backup-restored" style={{ marginTop: 8 }}>
            {restoreDone === 'overwrite' ? '上書き復元' : '統合復元'}が完了しました。
          </p>
        )}
        <button className="btn-danger-ghost" style={{ width: '100%', marginTop: 12 }} onClick={() => setResetting(true)} data-testid="reset-all">
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
      {pendingRestore && (
        <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="バックアップの復元">
          <div className="dialog" data-testid="restore-dialog">
            <h3>バックアップの復元</h3>
            <p>
              バックアップ日時：{pendingRestore.exportedAt ? new Date(pendingRestore.exportedAt).toLocaleString('ja-JP') : '不明'}
              <br />
              訪問記録 {Object.keys(pendingRestore.visits).length}件／保存ルート {pendingRestore.routes.length}件
            </p>
            <p className="msg info" style={{ margin: '8px 0' }}>
              「統合」は今の記録を残したままバックアップの内容を合わせます（同じ駅はバックアップ側を優先）。
              「上書き」は今の記録をすべてバックアップの内容に置き換えます。
            </p>
            <div className="actions" style={{ flexWrap: 'wrap' }}>
              <button onClick={() => setPendingRestore(null)}>キャンセル</button>
              <button
                onClick={() => {
                  onApplyRestore(pendingRestore, 'merge');
                  setPendingRestore(null);
                  setRestoreDone('merge');
                }}
                data-testid="restore-merge"
              >
                統合する
              </button>
              <button
                className="btn-danger-ghost"
                onClick={() => {
                  onApplyRestore(pendingRestore, 'overwrite');
                  setPendingRestore(null);
                  setRestoreDone('overwrite');
                }}
                data-testid="restore-overwrite"
              >
                上書きする
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
