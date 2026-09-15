import { describe, expect, it } from 'vitest';
import { nsKey } from './storageNamespace';

describe('nsKey（QA/本番のlocalStorage originすみ分け）', () => {
  it('VITE_STORAGE_NS未設定（本番/NAMIビルド相当）では、キー名を一切変更しない', () => {
    // vitestの実行環境ではVITE_STORAGE_NSは未設定であることが前提
    expect(nsKey('tohoku-me:visits:v2')).toBe('tohoku-me:visits:v2');
  });
});
