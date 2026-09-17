import { useState } from 'react';
import type { Prefecture, Station } from '../types';
import { PREFECTURES } from '../types';
import PlaceSearchBox from './PlaceSearchBox';
import { describeGeolocationError, getBestCurrentPosition } from '../lib/geolocation';
import type { OriginValue } from './PlannerForm';

/** 追加の出発地点モード（「地図から選ぶ」専用: 最初に選んだ駅から／選択駅の近くから、等） */
export interface ExtraOriginMode {
  key: string;
  label: string;
}

interface Props {
  stations: Station[];
  /** いま地図で見ている都道府県（候補の優先順位づけ用） */
  contextPrefectures?: Prefecture[];
  origin: OriginValue | null;
  onRequestMapPick: () => void;
  onOriginChange: (o: OriginValue | null) => void;
  /** 追加の出発地点モード（未指定なら現在地/住所/地図/道の駅の4つだけ） */
  extraModes?: ExtraOriginMode[];
  /** 追加モードが選ばれたときの実処理（呼び出し側がoriginを計算してonOriginChangeする） */
  onExtraMode?: (key: string) => void;
  /** 現在アクティブな追加モードのkey（ハイライト用） */
  activeExtraMode?: string | null;
}

/**
 * 出発地点の選択UI（現在地・住所・地図・道の駅から）。
 * PlannerForm（自動コース作成）と地図から選ぶルート作成の両方から使う共通部品。
 */
export default function OriginPicker({
  stations,
  contextPrefectures,
  origin,
  onRequestMapPick,
  onOriginChange,
  extraModes = [],
  onExtraMode,
  activeExtraMode,
}: Props) {
  const [originMode, setOriginMode] = useState<'geo' | 'search' | 'map' | 'station' | 'extra'>('geo');
  const [geoError, setGeoError] = useState<string | null>(null);

  const useGeolocation = () => {
    setGeoError(null);
    if (!('geolocation' in navigator)) {
      setGeoError('この端末では位置情報を使えません。住所か地図、道の駅からも選べます。');
      return;
    }
    void getBestCurrentPosition().then(({ position, error }) => {
      if (position) {
        onOriginChange({ lat: position.coords.latitude, lng: position.coords.longitude, label: '現在地' });
        return;
      }
      setGeoError(`${describeGeolocationError(error ?? { code: 2 })} 住所か地図、道の駅からも選べます。`);
    });
  };


  return (
    <div>
      <div className="seg" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
        <button className={originMode === 'geo' ? 'active' : ''} onClick={() => setOriginMode('geo')} data-testid="origin-mode-geo">
          現在地
        </button>
        <button
          className={originMode === 'search' ? 'active' : ''}
          onClick={() => setOriginMode('search')}
          data-testid="origin-mode-search"
        >
          🔎 名称・住所から探す
        </button>
        <button className={originMode === 'map' ? 'active' : ''} onClick={() => setOriginMode('map')}>
          地図で選ぶ
        </button>
        <button className={originMode === 'station' ? 'active' : ''} onClick={() => setOriginMode('station')}>
          道の駅から
        </button>
        {extraModes.map((m) => (
          <button
            key={m.key}
            className={originMode === 'extra' && activeExtraMode === m.key ? 'active' : ''}
            onClick={() => {
              setOriginMode('extra');
              onExtraMode?.(m.key);
            }}
            data-testid={`origin-extra-${m.key}`}
          >
            {m.label}
          </button>
        ))}
      </div>
      {originMode === 'geo' && (
        <>
          <button className="btn-primary" style={{ width: '100%' }} onClick={useGeolocation} data-testid="origin-geo-use">
            📍 現在地を使う
          </button>
          {geoError && (
            <div className="msg warn" data-testid="origin-geo-error">
              {geoError}
            </div>
          )}
        </>
      )}
      {originMode === 'search' && (
        <PlaceSearchBox
          stations={stations}
          contextPrefectures={contextPrefectures}
          onSelect={(c) => onOriginChange({ lat: c.lat, lng: c.lng, label: c.label })}
          testIdPrefix="origin"
        />
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
  );
}
