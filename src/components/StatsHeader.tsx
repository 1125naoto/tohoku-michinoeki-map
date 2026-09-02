import { useState } from 'react';
import type { Prefecture } from '../types';
import type { Stats } from '../lib/stats';

interface Props {
  stats: Stats;
  prefFilter: Prefecture | null;
  onSelectPref: (p: Prefecture | null) => void;
}

export default function StatsHeader({ stats, prefFilter, onSelectPref }: Props) {
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
          <span className="lbl">東北</span>
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
          {stats.byPref.map((ps) => (
            <button
              key={ps.pref}
              className={`pref-cell${prefFilter === ps.pref ? ' active' : ''}`}
              onClick={() => onSelectPref(prefFilter === ps.pref ? null : ps.pref)}
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
