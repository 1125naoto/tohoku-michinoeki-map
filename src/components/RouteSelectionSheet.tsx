import type { Station } from '../types';
import { getStatus, type HoursKind } from '../lib/hours';
import { MIN_MANUAL_STATIONS } from '../lib/manualRoute';
import { CATEGORY_LABEL, SUBCATEGORY_LABEL, poiDisplayName, type Poi } from '../lib/poi';

interface Props {
  selectedIds: string[];
  getStation: (id: string) => Station | undefined;
  /** 選択済みの周辺スポット（キー: Poi.id） */
  selectedPois: Record<string, Poi>;
  now: Date;
  onRemove: (id: string) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onClearAll: () => void;
  onClose: () => void;
  onProceed: () => void;
  /** POI行タップで詳細シートを開く（滞在時間の変更などはそちらで行う） */
  onOpenPoiDetail: (poi: Poi) => void;
}

const HOURS_BADGE: Record<HoursKind, { cls: string; text: string }> = {
  open: { cls: 'hopen', text: '営業中' },
  closing: { cls: 'want', text: 'まもなく終了' },
  closed: { cls: 'hclosed', text: '営業時間外' },
  unknown: { cls: 'pre', text: '要確認' },
  upcoming: { cls: 'pre', text: '開業前' },
};

/** 選択した道の駅・周辺スポットの一覧をボトムシートで表示（確認・削除・並び替え・全解除・次へ進む） */
export default function RouteSelectionSheet({
  selectedIds,
  getStation,
  selectedPois,
  now,
  onRemove,
  onMove,
  onClearAll,
  onClose,
  onProceed,
  onOpenPoiDetail,
}: Props) {
  const canProceed = selectedIds.length >= MIN_MANUAL_STATIONS;
  return (
    <section className="sheet route-select-sheet" data-testid="route-select-sheet" aria-label="選択した道の駅・周辺スポット">
      <div className="sheet-grip" />
      <button className="sheet-x" onClick={onClose} aria-label="閉じる" data-testid="route-select-sheet-close">
        ✕
      </button>
      <h2>選んだ地点（{selectedIds.length}件）</h2>
      {selectedIds.length === 0 && (
        <div className="empty">まだ選んでいません。地図で道の駅や周辺スポットをタップしてください。</div>
      )}
      <ol className="route-select-list">
        {selectedIds.map((id, i) => {
          const st = getStation(id);
          const poi = st ? undefined : selectedPois[id];
          const name = st?.name ?? (poi ? poiDisplayName(poi) : id);
          return (
            <li key={id} data-testid="route-select-row">
              <span className="route-select-num">{i + 1}</span>
              <span
                className="route-select-info"
                onClick={poi ? () => onOpenPoiDetail(poi) : undefined}
                style={poi ? { cursor: 'pointer' } : undefined}
              >
                <b>{name}</b>
                <span className="route-select-meta">
                  {st && (
                    <>
                      {st.pref}
                      {(() => {
                        const badge = HOURS_BADGE[getStatus(id, now).kind];
                        return (
                          <span className={`badge ${badge.cls}`} style={{ marginLeft: 6 }}>
                            {badge.text}
                          </span>
                        );
                      })()}
                    </>
                  )}
                  {poi && (
                    <span className="badge pre">
                      {CATEGORY_LABEL[poi.category]}・{SUBCATEGORY_LABEL[poi.subcategory]}
                    </span>
                  )}
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
                  aria-label={`${name}を削除`}
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
