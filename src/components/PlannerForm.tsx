import { useState } from 'react';
import type { PlanParams, PlanPriority, Prefecture, RoadPref, Station } from '../types';
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
  planning: boolean;
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

export default function PlannerForm({ stations, origin, onRequestMapPick, onOriginChange, onSubmit, planning }: Props) {
  const [originMode, setOriginMode] = useState<'geo' | 'search' | 'map' | 'station'>('geo');
  const [searchText, setSearchText] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);

  const [budgetMin, setBudgetMin] = useState(240);
  const [customBudget, setCustomBudget] = useState('');
  const [stayMin, setStayMin] = useState(30);
  const [customStay, setCustomStay] = useState('');
  const [priority, setPriority] = useState<PlanPriority>('unvisited');
  const [returnToStart, setReturnToStart] = useState(true);

  // こまかい設定（折りたたみ）
  const [advanced, setAdvanced] = useState(false);
  const [departNow, setDepartNow] = useState(true);
  const [departAt, setDepartAt] = useState(defaultDepartAt());
  const [roadPref, setRoadPref] = useState<RoadPref>('highway_ok');
  const [maxStops, setMaxStops] = useState(6);
  const [prefs, setPrefs] = useState<Prefecture[]>([]);
  const [crossPref, setCrossPref] = useState(true);
  const [includeVisited, setIncludeVisited] = useState(false);
  const [includeStamped, setIncludeStamped] = useState(false);
  const [preferOpenHours, setPreferOpenHours] = useState(true);
  const [includeClosedHours, setIncludeClosedHours] = useState(true);
  const [includeUnknownHours, setIncludeUnknownHours] = useState(true);

  const useGeolocation = () => {
    setGeoError(null);
    if (!('geolocation' in navigator)) {
      setGeoError('この端末では位置情報を使えません。住所か地図、道の駅からも選べます。');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => onOriginChange({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: '現在地' }),
      () => setGeoError('現在地がわかりませんでした。住所か地図、道の駅からも選べます。'),
      { timeout: 10000 },
    );
  };

  const doSearch = async () => {
    setSearching(true);
    setSearchError(null);
    try {
      const results = await geocode(searchText);
      if (results.length === 0) {
        setSearchError('見つかりませんでした。「地図で選ぶ」や「道の駅から」もお試しください。');
      } else {
        const r = results[0];
        onOriginChange({ lat: r.lat, lng: r.lng, label: r.label });
      }
    } catch {
      setSearchError('検索がうまくいきませんでした。「地図で選ぶ」や「道の駅から」もお試しください。');
    } finally {
      setSearching(false);
    }
  };

  const submit = () => {
    if (!origin || planning) return;
    // 任意時間は30分単位・1〜12時間に丸めて不正値を防ぐ
    let budget = budgetMin;
    if (customBudget !== '') {
      const raw = Number(customBudget);
      if (Number.isFinite(raw)) budget = Math.max(60, Math.min(720, Math.round(raw / 30) * 30));
    }
    let stay = stayMin;
    if (customStay !== '') {
      const raw = Number(customStay);
      if (Number.isFinite(raw)) stay = Math.max(5, Math.min(120, Math.round(raw / 5) * 5));
    }
    onSubmit({
      origin: { lat: origin.lat, lng: origin.lng, label: origin.label },
      departAt: departNow ? new Date().toISOString() : new Date(departAt).toISOString(),
      budgetMin: budget,
      stayMin: stay,
      returnToStart,
      roadPref,
      maxStops: Math.max(1, Math.min(15, maxStops)),
      prefs,
      crossPref,
      priority,
      includeVisited,
      includeStamped,
      preferOpenHours,
      includeClosedHours,
      includeUnknownHours,
    });
  };

  return (
    <div>
      <div className="card">
        <h3>1. どこから出発？</h3>
        <div className="seg" style={{ marginBottom: 10 }}>
          <button className={originMode === 'geo' ? 'active' : ''} onClick={() => setOriginMode('geo')}>
            現在地
          </button>
          <button className={originMode === 'search' ? 'active' : ''} onClick={() => setOriginMode('search')}>
            住所・地名
          </button>
          <button className={originMode === 'map' ? 'active' : ''} onClick={() => setOriginMode('map')}>
            地図で選ぶ
          </button>
          <button className={originMode === 'station' ? 'active' : ''} onClick={() => setOriginMode('station')}>
            道の駅から
          </button>
        </div>
        {originMode === 'geo' && (
          <>
            <button className="btn-primary" style={{ width: '100%' }} onClick={useGeolocation}>
              📍 現在地を使う
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
          </>
        )}
        {originMode === 'map' && (
          <button className="btn-primary" style={{ width: '100%' }} onClick={onRequestMapPick}>
            🗺️ 地図を開いてタップで選ぶ
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
          <div className="msg info">出発地点を選んでください</div>
        )}
      </div>

      <div className="card">
        <h3>2. 何時間のお出かけ？</h3>
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
          min={60}
          max={720}
          step={30}
          placeholder="自分で設定（分・30分きざみ）"
          aria-label="お出かけ時間を分で入力"
          value={customBudget}
          onChange={(e) => setCustomBudget(e.target.value)}
          style={{ width: '100%', marginTop: 6 }}
        />
        <p className="msg info" style={{ marginBottom: 0 }}>
          この時間の中に、移動・各駅での滞在・帰りの時間・安全余裕がぜんぶ入ります。
        </p>
      </div>

      <div className="card">
        <h3>3. 1駅に何分いる？</h3>
        <div className="seg">
          {STAYS.map((s) => (
            <button
              key={s}
              className={customStay === '' && stayMin === s ? 'active' : ''}
              onClick={() => {
                setStayMin(s);
                setCustomStay('');
              }}
            >
              {s}分
            </button>
          ))}
        </div>
        <input
          type="number"
          inputMode="numeric"
          min={5}
          max={120}
          step={5}
          placeholder="自分で設定（分）"
          aria-label="滞在時間を分で入力"
          value={customStay}
          onChange={(e) => setCustomStay(e.target.value)}
          style={{ width: '100%', marginTop: 6 }}
        />
      </div>

      <div className="card">
        <h3>4. 何を優先する？</h3>
        <div className="seg">
          <button
            className={priority === 'unvisited' ? 'active' : ''}
            onClick={() => setPriority('unvisited')}
            data-testid="priority-unvisited"
          >
            未訪問を優先
          </button>
          <button
            className={priority === 'wishlist' ? 'active' : ''}
            onClick={() => setPriority('wishlist')}
            data-testid="priority-wishlist"
          >
            行きたいを優先
          </button>
          <button
            className={priority === 'nearest' ? 'active' : ''}
            onClick={() => setPriority('nearest')}
            data-testid="priority-nearest"
          >
            近い順で回る
          </button>
        </div>
      </div>

      <div className="card">
        <h3>営業時間</h3>
        <button
          className={`seg-toggle ${preferOpenHours ? 'active' : ''}`}
          style={{
            width: '100%',
            border: '1px solid var(--border)',
            background: preferOpenHours ? 'var(--select)' : 'var(--surface)',
            color: preferOpenHours ? '#fff' : 'var(--text)',
            fontWeight: 700,
          }}
          onClick={() => setPreferOpenHours(!preferOpenHours)}
          data-testid="prefer-open-hours"
          aria-pressed={preferOpenHours}
        >
          🕒 営業時間内に到着できる駅を優先 {preferOpenHours ? 'ON' : 'OFF'}
        </button>
        <p className="msg info" style={{ marginBottom: 0 }}>
          通常営業時間に基づく目安です。臨時休業・季節変更は公式情報をご確認ください。
        </p>
      </div>

      <div className="card">
        <h3>5. 出発地点へ戻る？</h3>
        <div className="seg">
          <button className={returnToStart ? 'active' : ''} onClick={() => setReturnToStart(true)}>
            戻る
          </button>
          <button className={!returnToStart ? 'active' : ''} onClick={() => setReturnToStart(false)}>
            最後の道の駅で終了
          </button>
        </div>
      </div>

      <div className="card">
        <button
          style={{ width: '100%', textAlign: 'left', background: 'none', padding: 0, minHeight: 32 }}
          onClick={() => setAdvanced(!advanced)}
          aria-expanded={advanced}
        >
          <h3 style={{ margin: 0 }}>{advanced ? '▲' : '▼'} こまかい設定（出発日時・道路・県など）</h3>
        </button>
        {advanced && (
          <div style={{ marginTop: 10 }}>
            <div className="field">
              <label>出発日時</label>
              <div className="seg">
                <button className={departNow ? 'active' : ''} onClick={() => setDepartNow(true)}>
                  今から出発
                </button>
                <button className={!departNow ? 'active' : ''} onClick={() => setDepartNow(false)}>
                  日時を指定
                </button>
              </div>
              {!departNow && (
                <input
                  type="datetime-local"
                  value={departAt}
                  onChange={(e) => setDepartAt(e.target.value)}
                  style={{ width: '100%', marginTop: 6 }}
                  aria-label="出発日時"
                />
              )}
            </div>
            <div className="field">
              <label>道路</label>
              <div className="seg">
                <button className={roadPref === 'highway_ok' ? 'active' : ''} onClick={() => setRoadPref('highway_ok')}>
                  高速道路OK
                </button>
                <button className={roadPref === 'no_highway' ? 'active' : ''} onClick={() => setRoadPref('no_highway')}>
                  高速を避ける
                </button>
                <button className={roadPref === 'no_tolls' ? 'active' : ''} onClick={() => setRoadPref('no_tolls')}>
                  有料を避ける
                </button>
              </div>
              {roadPref !== 'highway_ok' && (
                <p className="msg info" style={{ marginBottom: 0 }}>
                  回避の条件は、Googleマップを開くときに反映されます（コース計算の時間には反映されません）。
                </p>
              )}
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
                    越えてOK
                  </button>
                  <button className={!crossPref ? 'active' : ''} onClick={() => setCrossPref(false)}>
                    同じ県だけ
                  </button>
                </div>
              </div>
            </div>
            <div className="field">
              <label>行きたい県（未選択＝東北ぜんぶ）</label>
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
            <div className="field">
              <label>営業時間の条件</label>
              <div className="seg">
                <button
                  className={includeClosedHours ? 'active' : ''}
                  onClick={() => setIncludeClosedHours(!includeClosedHours)}
                  data-testid="include-closed-hours"
                >
                  時間外予想の駅も含める{includeClosedHours ? ' ✓' : ''}
                </button>
                <button
                  className={includeUnknownHours ? 'active' : ''}
                  onClick={() => setIncludeUnknownHours(!includeUnknownHours)}
                  data-testid="include-unknown-hours"
                >
                  営業時間不明の駅も含める{includeUnknownHours ? ' ✓' : ''}
                </button>
              </div>
              <p className="msg info" style={{ marginBottom: 0 }}>
                駐車場・トイレは24時間使えるため、時間外でも立ち寄り自体は可能です。
              </p>
            </div>
            <div className="field">
              <label>もう行った駅も候補に入れる？（ふだんはOFF）</label>
              <div className="seg">
                <button
                  className={includeVisited ? 'active' : ''}
                  onClick={() => setIncludeVisited(!includeVisited)}
                  data-testid="include-visited"
                >
                  訪問済みも入れる{includeVisited ? ' ✓' : ''}
                </button>
                <button
                  className={includeStamped ? 'active' : ''}
                  onClick={() => setIncludeStamped(!includeStamped)}
                  data-testid="include-stamped"
                >
                  スタンプ済みも入れる{includeStamped ? ' ✓' : ''}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <button
        className="btn-primary"
        style={{ width: '100%', minHeight: 52, fontSize: 17 }}
        disabled={!origin || planning}
        onClick={submit}
        data-testid="plan-submit"
      >
        {planning ? '⏳ コースを計算中…' : '🚗 コースを作る'}
      </button>
      <p className="msg info" style={{ marginTop: 10 }}>
        所要時間は目安です。実際の経路・渋滞・通行止めはGoogleマップで確認してください。
      </p>
    </div>
  );
}
