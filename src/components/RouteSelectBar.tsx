import { MIN_MANUAL_STATIONS } from '../lib/manualRoute';

interface Props {
  count: number;
  onShowList: () => void;
  onCreate: () => void;
  onClearAll: () => void;
  onExit: () => void;
}

/**
 * 地図下部に固定するコンパクトな選択バー（D/E仕様）。
 * 全画面解除・現在地・凡例・ズーム・Leaflet帰属・safe-areaと重ならない位置に置く。
 */
export default function RouteSelectBar({ count, onShowList, onCreate, onClearAll, onExit }: Props) {
  const canCreate = count >= MIN_MANUAL_STATIONS;
  return (
    <div className="route-select-bar" data-testid="route-select-bar">
      <div className="route-select-bar-row">
        <b data-testid="route-select-count">{count}駅選択中</b>
        <div className="route-select-bar-sub">
          <button onClick={onClearAll} data-testid="route-select-clear-all">
            すべて解除
          </button>
          <button onClick={onExit} data-testid="route-select-exit">
            選択をやめる
          </button>
        </div>
      </div>
      {!canCreate && (
        <p className="msg warn" style={{ margin: '4px 0' }} data-testid="route-select-min-hint">
          {MIN_MANUAL_STATIONS}駅以上選んでください
        </p>
      )}
      <div className="btn-grid">
        <button onClick={onShowList} data-testid="route-select-show-list">
          選んだ駅を見る
        </button>
        <button
          className="btn-primary"
          disabled={!canCreate}
          onClick={onCreate}
          data-testid="route-select-create"
        >
          この駅でコース作成
        </button>
      </div>
    </div>
  );
}
