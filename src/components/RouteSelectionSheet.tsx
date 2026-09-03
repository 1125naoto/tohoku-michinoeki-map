import type { Station } from '../types';
import { getStatus, type HoursKind } from '../lib/hours';
import { MIN_MANUAL_STATIONS } from '../lib/manualRoute';

interface Props {
  selectedIds: string[];
  getStation: (id: string) => Station | undefined;
  now: Date;
  onRemove: (id: string) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onClearAll: () => void;
  onClose: () => void;
  onProceed: () => void;
}

const HOURS_BADGE: Record<HoursKind, { cls: string; text: string }> = {
  open: { cls: 'hopen', text: '営業中' },
  closing: { cls: 'want', text: 'まもなく終了' },
  closed: { cls: 'hclosed', text: '営業時間外' },
  unknown: { cls: 'pre', text: '要確認' },
  upcoming: { cls: 'pre', text: '開業前' },
};

/** 選択した駅の一覧をボトムシートで表示（確認・削除・並び替え・全解除・次へ進む） */
export default function RouteSelectionSheet({
  selectedIds,
  getStation,
  now,
  onRemove,
  onMove,
  onClearAll,
  onClose,
  onProceed,
}: Props) {
  const canProceed = selectedIds.length >= MIN_MANUAL_STATIONS;
  return (
    <section className="sheet route-select-sheet" data-testid="route-select-sheet" aria-label="選択した道の駅">
      <div className="sheet-grip" />
      <button className="sheet-x" onClick={onClose} aria-label="閉じる" data-testid="route-select-sheet-close">
        ✕
      </button>
      <h2>選んだ道の駅（{selectedIds.length}駅）</h2>
      {selectedIds.length === 0 && <div className="empty">まだ選んでいません。地図で道の駅をタップしてください。</div>}
      <ol className="route-select-list">
        {selectedIds.map((id, i) => {
          const st = getStation(id);
          const hs = getStatus(id, now);
          const badge = HOURS_BADGE[hs.kind];
          return (
            <li key={id} data-testid="route-select-row">
              <span className="route-select-num">{i + 1}</span>
              <span className="route-select-info">
                <b>{st?.name ?? id}</b>
                <span className="route-select-meta">
                  {st?.pref}
                  <span className={`badge ${badge.cls}`} style={{ marginLeft: 6 }}>
                    {badge.text}
                  </span>
                </span>
              </span>
              <span className="route-select-actions">
                <button
                  aria-label="上へ移動"
                  onClick={() => onMove(i, -1)}
                  disabled={i === 0}
                  data-testid="route-select-up"
                >
                  ▲
                </button>
                <button
                  aria-label="下へ移動"
                  onClick={() => onMove(i, 1)}
                  disabled={i === selectedIds.length - 1}
                  data-testid="route-select-down"
                >
                  ▼
                </button>
                <button
                  className="btn-danger-ghost"
                  aria-label={`${st?.name ?? id}を削除`}
                  onClick={() => onRemove(id)}
                  data-testid="route-select-remove"
                >
                  削除
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      <div className="btn-grid" style={{ marginTop: 10 }}>
        <button onClick={onClearAll} data-testid="route-select-sheet-clear">
          全解除
        </button>
        <button
          className="btn-primary"
          disabled={!canProceed}
          onClick={onProceed}
          data-testid="route-select-sheet-proceed"
        >
          コース設定へ進む
        </button>
      </div>
      {!canProceed && (
        <p className="msg warn" style={{ marginTop: 6 }}>
          {MIN_MANUAL_STATIONS}駅以上選んでください
        </p>
      )}
    </section>
  );
}
