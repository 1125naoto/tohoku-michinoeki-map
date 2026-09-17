import { useState } from 'react';
import type { CustomStopInfo, Station } from '../types';
import { searchPlaces, type PlaceCandidate } from '../lib/placeSearch';
import { OSM_ATTRIBUTION } from '../lib/nominatim';

interface Props {
  /** 道の駅名でも探せるようにするためのマスターデータ */
  stations: Station[];
  /** フォーム見出し（用途によって文言を変える: 経由地追加/最終目的地の指定 等） */
  title: string;
  /** 確定ボタンの文言 */
  submitLabel: string;
  onSubmit: (info: CustomStopInfo) => void;
  onCancel: () => void;
  /** 見つからないとき・通信失敗時の逃げ道。渡されたときだけ「地図で選ぶ」を出す */
  onRequestMapPick?: () => void;
}

/**
 * アプリ未登録の場所（自由地点: ホテル・旅館・飲食店・自宅等）をルートへ追加するフォーム。
 * 座標は出発地点と同じ共通検索（lib/placeSearch.ts）で解決する。施設名はOpenStreetMap
 * Nominatim、住所は国土地理院 住所検索API、道の駅はアプリ内データ。いずれも無料・
 * APIキー不要で、新規の有料API（Google Places等）は導入しない。
 * バックエンドへは送らず、この端末のlocalStorageにのみ保存する（既存privacy方針と同一）。
 */
export default function CustomStopForm({
  stations,
  title,
  submitLabel,
  onSubmit,
  onCancel,
  onRequestMapPick,
}: Props) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<{ lat: number; lng: number; label: string } | null>(null);
  /** 候補が複数あるときに選び直せるようにする（先頭は自動で採用する） */
  const [candidates, setCandidates] = useState<PlaceCandidate[]>([]);
  const [showOsmCredit, setShowOsmCredit] = useState(false);

  const doSearch = async () => {
    if (!address.trim()) return;
    setSearching(true);
    setError(null);
    setResolved(null);
    setCandidates([]);
    try {
      const { candidates: found, usedOsm } = await searchPlaces(address, stations);
      setCandidates(found);
      setShowOsmCredit(usedOsm);
      if (found.length === 0) {
        setError(
          '見つかりませんでした。施設名（例: 郡山IC、秋田駅）、住所、道の駅名でお試しください。',
        );
      } else {
        setResolved({ lat: found[0].lat, lng: found[0].lng, label: found[0].label });
      }
    } catch {
      setError('検索がうまくいきませんでした。電波状況を確認してもう一度お試しください。');
    } finally {
      setSearching(false);
    }
  };

  const confirm = () => {
    if (!resolved) return;
    onSubmit({ name: name.trim() ? name.trim() : null, address: address.trim(), lat: resolved.lat, lng: resolved.lng });
  };

  return (
    <div className="card" data-testid="custom-stop-form">
      <h3>{title}</h3>
      <p className="msg info" style={{ marginTop: -4 }}>
        アプリに登録されていないホテル・旅館・飲食店・観光地・自宅等を、名称（任意）と住所で追加できます。
      </p>
      <label style={{ display: 'block', marginTop: 8 }}>
        名称（任意）
        <input
          style={{ width: '100%', marginTop: 4 }}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: ○○ホテル"
          aria-label="名称（任意）"
          data-testid="custom-stop-name"
        />
      </label>
      <label style={{ display: 'block', marginTop: 8 }}>
        名称・住所
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <input
            style={{ flex: 1, minWidth: 0 }}
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              setResolved(null);
            }}
            placeholder="例: 郡山IC、○○ホテル、山形県山形市○○1-2-3"
            aria-label="名称・住所"
            data-testid="custom-stop-address"
          />
          <button
            className="btn-primary"
            onClick={doSearch}
            disabled={searching || !address.trim()}
            data-testid="custom-stop-search"
          >
            {searching ? '検索中…' : '検索'}
          </button>
        </div>
      </label>
      {error && (
        <div className="msg warn" style={{ marginTop: 8 }} data-testid="custom-stop-error">
          {error}
          {onRequestMapPick && (
            <button
              type="button"
              className="btn-primary"
              style={{ width: '100%', marginTop: 8 }}
              onClick={onRequestMapPick}
              data-testid="custom-stop-map-pick"
            >
              🗺️ 地図で選ぶ
            </button>
          )}
        </div>
      )}
      {resolved && (
        <div className="msg info" style={{ marginTop: 8 }} data-testid="custom-stop-resolved">
          ✅ 場所を特定しました: {resolved.label}
        </div>
      )}
      {candidates.length > 1 && (
        <ul className="origin-candidates" data-testid="custom-stop-search-results">
          {candidates.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className={`origin-candidate${resolved?.label === c.label ? ' active' : ''}`}
                onClick={() => setResolved({ lat: c.lat, lng: c.lng, label: c.label })}
                data-testid="custom-stop-search-result"
              >
                <span className="origin-candidate-name">{c.label}</span>
                {c.sub && <span className="origin-candidate-sub">{c.sub}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {candidates.length > 0 && showOsmCredit && (
        <p className="place-search-credit" data-testid="custom-stop-search-credit">
          施設名の検索結果に {OSM_ATTRIBUTION} を含みます
        </p>
      )}
      <div className="btn-grid" style={{ marginTop: 10 }}>
        <button onClick={onCancel} data-testid="custom-stop-cancel">
          キャンセル
        </button>
        <button
          className="btn-primary"
          disabled={!resolved}
          onClick={confirm}
          data-testid="custom-stop-confirm"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
