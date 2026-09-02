import { useState } from 'react';
import type { PlanParams, Prefecture, Station } from '../types';
import { PREFECTURES } from '../types';
import { geocode } from '../lib/geocode';
import type { LatLng } from '../lib/geo';

export interface OriginValue extends LatLng {
  label: string;
}

interface Props {
  stations: Station[];
  origin: OriginValue | null;
  onRequestMapPick: () => void;
  onOriginChange: (o: OriginValue | null) => void;
  onSubmit: (params: PlanParams) => void;
}

function defaultDepartAt(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 30 - (d.getMinutes() % 15), 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const BUDGETS = [
  { label: '2時間', min: 120 },
  { label: '4時間', min: 240 },
  { label: '6時間', min: 360 },
  { label: '8時間', min: 480 },
];
const STAYS = [15, 30, 45, 60];

export default function PlannerForm({ stations, origin, onRequestMapPick, onOriginChange, onSubmit }: Props) {
  const [originMode, setOriginMode] = useState<'geo' | 'search' | 'map' | 'station'>('geo');
  const [searchText, setSearchText] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);

  const [departAt, setDepartAt] = useState(defaultDepartAt());
  const [budgetMin, setBudgetMin] = useState(240);
  const [customBudget, setCustomBudget] = useState('');
  const [stayMin, setStayMin] = useState(30);
  const [returnToStart, setReturnToStart] = useState(true);
  const [useHighway, setUseHighway] = useState(false);
  const [maxStops, setMaxStops] = useState(6);
  const [prefs, setPrefs] = useState<Prefecture[]>([]);
  const [crossPref, setCrossPref] = useState(true);
  const [target, setTarget] = useState<PlanParams['target']>('unvisited');

  const useGeolocation = () => {
    setGeoError(null);
    if (!('geolocation' in navigator)) {
      setGeoError('この端末では位置情報を利用できません。住所検索・地図指定・道の駅指定をご利用ください。');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => onOriginChange({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: '現在地' }),
      () =>
        setGeoError('位置情報を取得できませんでした（許可は必須ではありません）。住所検索・地図指定・道の駅指定でも設定できます。'),
      { timeout: 10000 },
    );
  };

  const doSearch = async () => {
    setSearching(true);
    setSearchError(null);
    try {
      const results = await geocode(searchText);
      if (results.length === 0) {
        setSearchError('見つかりませんでした。表記を変えるか、地図指定・道の駅指定をお試しください。');
      } else {
        const r = results[0];
        onOriginChange({ lat: r.lat, lng: r.lng, label: r.label });
      }
    } catch {
      setSearchError('検索サービスに接続できませんでした。地図指定・道の駅指定でも設定できます。');
    } finally {
      setSearching(false);
    }
  };

  const submit = () => {
    if (!origin) return;
    const budget = customBudget !== '' ? Math.max(30, Number(customBudget)) : budgetMin;
    onSubmit({
      origin: { lat: origin.lat, lng: origin.lng, label: origin.label },
      departAt: new Date(departAt).toISOString(),
      budgetMin: budget,
      stayMin,
      returnToStart,
      useHighway,
      maxStops: Math.max(1, Math.min(15, maxStops)),
      prefs,
      crossPref,
      target,
    });
  };

  return (
    <div>
      <div className="card">
        <h3>1. 出発地点</h3>
        <div className="seg" style={{ marginBottom: 10 }}>
          <button className={originMode === 'geo' ? 'active' : ''} onClick={() => setOriginMode('geo')}>
            現在地
          </button>
          <button className={originMode === 'search' ? 'active' : ''} onClick={() => setOriginMode('search')}>
            住所・地名
          </button>
          <button className={originMode === 'map' ? 'active' : ''} onClick={() => setOriginMode('map')}>
            地図で指定
          </button>
          <button className={originMode === 'station' ? 'active' : ''} onClick={() => setOriginMode('station')}>
            道の駅から
          </button>
        </div>
        {originMode === 'geo' && (
          <>
            <button className="btn-primary" style={{ width: '100%' }} onClick={useGeolocation}>
              📍 現在地を取得する
            </button>
            {geoError && <div className="msg warn">{geoError}</div>}
          </>
        )}
        {originMode === 'search' && (
          <>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                style={{ flex: 1, minWidth: 0 }}
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="例: 郡山市、盛岡駅"
                aria-label="住所・地名"
              />
              <button className="btn-primary" onClick={doSearch} disabled={searching || !searchText.trim()}>
                {searching ? '検索中…' : '検索'}
              </button>
            </div>
            {searchError && <div className="msg warn">{searchError}</div>}
            <p className="msg info">検索には国土地理院の住所検索を利用します。</p>
          </>
        )}
        {originMode === 'map' && (
          <button className="btn-primary" style={{ width: '100%' }} onClick={onRequestMapPick}>
            🗺️ 地図を開いてタップで指定
          </button>
        )}
        {originMode === 'station' && (
          <select
            style={{ width: '100%' }}
            aria-label="出発する道の駅"
            value=""
            onChange={(e) => {
              const st = stations.find((s) => s.id === e.target.value);
              if (st) onOriginChange({ lat: st.lat, lng: st.lng, label: `道の駅${st.name}` });
            }}
          >
            <option value="">道の駅を選択…</option>
            {PREFECTURES.map((p) => (
              <optgroup key={p} label={p}>
                {stations
                  .filter((s) => s.pref === p && s.status === 'open')
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}（{s.city}）
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        )}
        {origin ? (
          <div className="origin-label" data-testid="origin-label">
            出発地点: <b>{origin.label}</b>
          </div>
        ) : (
          <div className="msg info">出発地点を設定してください</div>
        )}
      </div>

      <div className="card">
        <h3>2. 日程・条件</h3>
        <div className="field">
          <label htmlFor="departAt">出発予定日時</label>
          <input
            id="departAt"
            type="datetime-local"
            value={departAt}
            onChange={(e) => setDepartAt(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>
        <div className="field">
          <label>使用可能時間（移動＋滞在＋帰路すべて込み）</label>
          <div className="seg">
            {BUDGETS.map((b) => (
              <button
                key={b.min}
                className={customBudget === '' && budgetMin === b.min ? 'active' : ''}
                onClick={() => {
                  setBudgetMin(b.min);
                  setCustomBudget('');
                }}
              >
                {b.label}
              </button>
            ))}
          </div>
          <input
            type="number"
            inputMode="numeric"
            min={30}
            step={30}
            placeholder="任意入力（分）"
            aria-label="使用可能時間を分で入力"
            value={customBudget}
            onChange={(e) => setCustomBudget(e.target.value)}
            style={{ width: '100%', marginTop: 6 }}
          />
        </div>
        <div className="field">
          <label>1駅あたりの滞在時間</label>
          <div className="seg">
            {STAYS.map((s) => (
              <button key={s} className={stayMin === s ? 'active' : ''} onClick={() => setStayMin(s)}>
                {s}分
              </button>
            ))}
          </div>
        </div>
        <div className="row2">
          <div className="field">
            <label>出発地点へ戻る</label>
            <div className="seg">
              <button className={returnToStart ? 'active' : ''} onClick={() => setReturnToStart(true)}>
                戻る
              </button>
              <button className={!returnToStart ? 'active' : ''} onClick={() => setReturnToStart(false)}>
                戻らない
              </button>
            </div>
          </div>
          <div className="field">
            <label>高速道路</label>
            <div className="seg">
              <button className={useHighway ? 'active' : ''} onClick={() => setUseHighway(true)}>
                使う
              </button>
              <button className={!useHighway ? 'active' : ''} onClick={() => setUseHighway(false)}>
                使わない
              </button>
            </div>
          </div>
        </div>
        <div className="row2">
          <div className="field">
            <label htmlFor="maxStops">最大立ち寄り駅数</label>
            <input
              id="maxStops"
              type="number"
              inputMode="numeric"
              min={1}
              max={15}
              value={maxStops}
              onChange={(e) => setMaxStops(Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>
          <div className="field">
            <label>県境</label>
            <div className="seg">
              <button className={crossPref ? 'active' : ''} onClick={() => setCrossPref(true)}>
                越えてよい
              </button>
              <button className={!crossPref ? 'active' : ''} onClick={() => setCrossPref(false)}>
                同一県内
              </button>
            </div>
          </div>
        </div>
        <div className="field">
          <label>対象県（未選択＝東北6県すべて）</label>
          <div className="seg">
            {PREFECTURES.map((p) => (
              <button
                key={p}
                className={prefs.includes(p) ? 'active' : ''}
                onClick={() => setPrefs(prefs.includes(p) ? prefs.filter((x) => x !== p) : [...prefs, p])}
              >
                {p.replace('県', '')}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <h3>3. 対象駅</h3>
        <div className="seg">
          <button className={target === 'unvisited' ? 'active' : ''} onClick={() => setTarget('unvisited')}>
            未訪問のみ
          </button>
          <button className={target === 'want_priority' ? 'active' : ''} onClick={() => setTarget('want_priority')}>
            行きたい駅を優先
          </button>
          <button className={target === 'all' ? 'active' : ''} onClick={() => setTarget('all')}>
            すべて
          </button>
        </div>
      </div>

      <button
        className="btn-primary"
        style={{ width: '100%', minHeight: 52, fontSize: 17 }}
        disabled={!origin}
        onClick={submit}
        data-testid="plan-submit"
      >
        🚗 週末ルートを作る
      </button>
      <p className="msg info" style={{ marginTop: 10 }}>
        所要時間は目安です。実際の渋滞、積雪、通行止め、道路状況、営業時間はGoogleマップと公式サイトで確認してください。
      </p>
    </div>
  );
}
