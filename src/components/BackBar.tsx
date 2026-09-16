interface Props {
  /** 戻り先が分かる文言（例: 「地図へ戻る」）。押すと onBack を呼ぶ */
  label: string;
  onBack: () => void;
  testId?: string;
}

/**
 * サブ画面の左上に置く「← 戻る」導線。
 *
 * ブラウザの history.back() は使わない。アプリ内のstateで開いた画面は同じstateで
 * 戻す（外部リンクから復帰した直後などに意図しない画面へ飛ばさないため）。
 * 既に「✕ 閉じる」「キャンセル」等の自然な戻り導線がある画面には付けない
 * （二重の戻るUIを作らない）。
 */
export default function BackBar({ label, onBack, testId }: Props) {
  return (
    <button type="button" className="back-bar" onClick={onBack} data-testid={testId ?? 'back-bar'}>
      ← {label}
    </button>
  );
}
