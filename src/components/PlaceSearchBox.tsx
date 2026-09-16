import { useState } from 'react';
import { searchPlaces, type PlaceCandidate } from '../lib/placeSearch';
import { OSM_ATTRIBUTION } from '../lib/nominatim';
import type { Station } from '../types';

interface Props {
  stations: Station[];
  /** 候補が選ばれたとき。呼び出し側が出発地点/経由地/最終目的地として使う */
  onSelect: (c: PlaceCandidate) => void;
  placeholder?: string;
  /** data-testidの接頭辞（出発地点=origin / 自由地点=custom-stop 等） */
  testIdPrefix: string;
}

/**
 * 名称・住所から地点を探す共通UI。出発地点・経由地・最終目的地で同じものを使う。
 *
 * 入力のたびには検索しない（Nominatimの公開インスタンスはオートコンプリート禁止）。
 * 「検索」ボタンを押したときだけ1回問い合わせる。
 */
export default function PlaceSearchBox({ stations, onSelect, placeholder, testIdPrefix }: Props) {
  const [text, setText] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<PlaceCandidate[] | null>(null);
  const [showOsmCredit, setShowOsmCredit] = useState(false);

  const run = async () => {
    setSearching(true);
    setError(null);
    setCandidates(null);
    try {
      const { candidates: found, geocodeFailed, usedOsm } = await searchPlaces(text, stations);
      setCandidates(found);
      setShowOsmCredit(usedOsm);
      if (found.length === 0) {
        setError(
          geocodeFailed
            ? '検索がうまくいきませんでした。電波状況を確認してもう一度お試しください。「地図で選ぶ」でも指定できます。'
            : '見つかりませんでした。施設名（例: 郡山IC、秋田駅）、住所、道の駅名でお試しください。',
        );
      }
    } catch {
      setError('検索がうまくいきませんでした。「地図で選ぶ」でも指定できます。');
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="place-search">
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          style={{ flex: 1, minWidth: 0 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && text.trim() && !searching) void run();
          }}
          placeholder={placeholder ?? '例: 郡山IC、秋田駅、福島県郡山市'}
          aria-label="名称・住所"
          data-testid={`${testIdPrefix}-search-input`}
        />
        <button
          type="button"
          className="btn-primary"
          onClick={run}
          disabled={searching || !text.trim()}
          data-testid={`${testIdPrefix}-search-run`}
        >
          {searching ? '検索中…' : '検索'}
        </button>
      </div>
      {error && (
        <div className="msg warn" data-testid={`${testIdPrefix}-search-error`}>
          {error}
        </div>
      )}
      {candidates && candidates.length > 0 && (
        <>
          <ul className="origin-candidates" data-testid={`${testIdPrefix}-search-results`}>
            {candidates.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="origin-candidate"
                  onClick={() => onSelect(c)}
                  data-testid={`${testIdPrefix}-search-result`}
                >
                  <span className="origin-candidate-name">{c.label}</span>
                  {c.sub && <span className="origin-candidate-sub">{c.sub}</span>}
                </button>
              </li>
            ))}
          </ul>
          {showOsmCredit && (
            <p className="place-search-credit" data-testid={`${testIdPrefix}-search-credit`}>
              施設名の検索結果に {OSM_ATTRIBUTION} を含みます
            </p>
          )}
        </>
      )}
    </div>
  );
}
