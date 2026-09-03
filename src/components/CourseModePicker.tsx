export type CourseMode = 'auto' | 'manual';

interface Props {
  lastUsed: CourseMode | null;
  onChoose: (mode: CourseMode) => void;
}

/**
 * 「コース」タブの入口: おすすめコース（自動選定） / 地図から選ぶ（手動選択）の
 * 2方式を選ぶ画面。前回使った方式があればハイライトするが、初めて使う人にも
 * 違いがすぐ分かるよう、選ぶまでは常にこの画面を経由させる。
 */
export default function CourseModePicker({ lastUsed, onChoose }: Props) {
  return (
    <div>
      <h3 style={{ margin: '4px 0 10px' }}>コースの作り方を選んでください</h3>
      <button
        className={`mode-card${lastUsed === 'auto' ? ' last-used' : ''}`}
        onClick={() => onChoose('auto')}
        data-testid="course-mode-auto"
      >
        <div className="mode-card-icon" aria-hidden="true">
          🚗
        </div>
        <div className="mode-card-body">
          <h3>おすすめコース</h3>
          <p>時間や条件に合わせて、回りやすい道の駅を自動で選びます</p>
          {lastUsed === 'auto' && <span className="mode-card-last">前回はこちら</span>}
        </div>
      </button>
      <button
        className={`mode-card${lastUsed === 'manual' ? ' last-used' : ''}`}
        onClick={() => onChoose('manual')}
        data-testid="course-mode-manual"
      >
        <div className="mode-card-icon" aria-hidden="true">
          🗺️
        </div>
        <div className="mode-card-body">
          <h3>地図から選ぶ</h3>
          <p>地図上で行きたい道の駅を選び、回りやすい順番に並べます</p>
          {lastUsed === 'manual' && <span className="mode-card-last">前回はこちら</span>}
        </div>
      </button>
    </div>
  );
}
