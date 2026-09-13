import { useState } from 'react';
import type { Prefecture } from '../types';
import type { Stats } from '../lib/stats';
import type { SelectedPrefectures } from '../lib/ui';

interface Props {
  stats: Stats;
  selectedPrefectures: SelectedPrefectures;
  /** 都道府県のトグル（既に選択中なら解除、未選択なら追加）。空配列を渡すと全国（絞り込み解除）。 */
  onToggleClearPref: (p: Prefecture | 'all') => void;
}

export default function StatsHeader({ stats, selectedPrefectures, onToggleClearPref }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <header className="stats-header">
      <button
        className="stats-main"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        data-testid="stats-toggle"
      >
        <span className="stat-block">
          <span className="lbl">全駅</span>
          <span className="val" data-testid="stats-visited">
            {stats.visited}／{stats.total}駅
          </span>
        </span>
        <span className="stat-block">
          <span className="lbl">達成率</span>
          <span className="val" data-testid="stats-percent">
            {stats.percent}％
          </span>
        </span>
        <span className="stat-block">
          <span className="lbl">スタンプ</span>
          <span className="val" data-testid="stats-stamped">
            {stats.stamped}
            <small>個</small>
          </span>
        </span>
        <span className="chev">{open ? '▲ 閉じる' : '▼ 県別'}</span>
      </button>
      {open && (
        <div className="pref-grid" data-testid="pref-grid">
          {/* 都道府県は複数選択可（OR）。「全国」は選択解除の一発リセット。 */}
          <button
            className={`pref-cell${selectedPrefectures.length === 0 ? ' active' : ''}`}
            onClick={() => onToggleClearPref('all')}
            data-testid="pref-all"
          >
            <div>全国</div>
          </button>
          {stats.byPref.map((ps) => (
            <button
              key={ps.pref}
              className={`pref-cell${selectedPrefectures.includes(ps.pref) ? ' active' : ''}`}
              onClick={() => onToggleClearPref(ps.pref)}
              data-testid={`pref-${ps.pref}`}
            >
              <div>{ps.pref.replace('県', '')}</div>
              <div>
                <span className="n">
                  {ps.visited}／{ps.total}駅
                </span>{' '}
                <span className="pct">{ps.total ? Math.round((ps.visited / ps.total) * 100) : 0}％</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </header>
  );
}
