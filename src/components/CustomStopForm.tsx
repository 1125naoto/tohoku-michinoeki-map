import { useState } from 'react';
import type { CustomStopInfo } from '../types';
import { geocode } from '../lib/geocode';

interface Props {
  /** フォーム見出し（用途によって文言を変える: 経由地追加/最終目的地の指定 等） */
  title: string;
  /** 確定ボタンの文言 */
  submitLabel: string;
  onSubmit: (info: CustomStopInfo) => void;
  onCancel: () => void;
}

/**
 * アプリ未登録の場所（自由地点: ホテル・旅館・飲食店・自宅等）をルートへ追加するフォーム。
 * 座標は既存の出発地点検索と同じ仕組み（国土地理院 住所検索API・無料・APIキー不要・
 * lib/geocode.ts）で解決する。新規の有料API（Google Places等）は導入しない。
 * バックエンドへは送らず、この端末のlocalStorageにのみ保存する（既存privacy方針と同一）。
 */
export default function CustomStopForm({ title, submitLabel, onSubmit, onCancel }: Props) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<{ lat: number; lng: number; label: string } | null>(null);

  const doSearch = async () => {
    if (!address.trim()) return;
    setSearching(true);
    setError(null);
    setResolved(null);
    try {
      const results = await geocode(address);
      if (results.length === 0) {
        setError('住所・地名が見つかりませんでした。表記を変えて（例: 市区町村名を含める）もう一度お試しください。');
      } else {
        setResolved({ lat: results[0].lat, lng: results[0].lng, label: results[0].label });
      }
    } catch {
      setError('住所検索がうまくいきませんでした。電波状況を確認してもう一度お試しください。');
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
        住所・地名
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <input
            style={{ flex: 1, minWidth: 0 }}
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              setResolved(null);
            }}
            placeholder="例: 山形県山形市○○1-2-3"
            aria-label="住所・地名"
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
        </div>
      )}
      {resolved && (
        <div className="msg info" style={{ marginTop: 8 }} data-testid="custom-stop-resolved">
          ✅ 場所を特定しました: {resolved.label}
        </div>
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
