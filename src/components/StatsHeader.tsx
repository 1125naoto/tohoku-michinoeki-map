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
        <span className="title">東北全体</span>
        <span className="big" data-testid="stats-visited">
          {stats.visited}／{stats.total}駅
        </span>
        <span className="big" data-testid="stats-percent">
          {stats.percent}％
        </span>
        <span className="sub">スタンプ {stats.stamped}</span>
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
