import { useState } from 'react';
import PrefectureChipGroups from './PrefectureChipGroups';
import type { AreaStat, PrefStat } from '../lib/stats';
import type { SelectedPrefectures } from '../lib/ui';
import { prefecturesInArea } from '../lib/ui';
import type { AreaName, Prefecture } from '../types';

interface Props {
  areas: AreaStat[];
  statByPref: Map<Prefecture, PrefStat>;
  /** 収録されている道の駅の総数（「全国を見る」の説明に使う） */
  totalStations: number;
  /** 現在の表示範囲。県選択の下書きの初期値に使う */
  selectedPrefectures: SelectedPrefectures;
  /** 選んだ県を確定して地図へ進む（空配列＝全国） */
  onCommit: (prefs: SelectedPrefectures) => void;
  /** 地図から「地域を変更」で開いた場合のみ、選び直さずに戻れる。初回起動時はnull */
  onCancel: (() => void) | null;
}

/** 画面内のステップ。ブラウザhistoryには依存せず、このstateだけで前後する。 */
type Step =
  /** 「どこを旅しますか？」地域ブロックを選ぶ */
  | { kind: 'region' }
  /** 「何県を回りますか？」選んだ地域の県から複数選ぶ */
  | { kind: 'area'; area: AreaName }
  /** 「都道府県から選ぶ」全国47県から複数選ぶ */
  | { kind: 'all' };

/**
 * 「どこを旅しますか？」— 初回起動（および「地域を変更」）の入口画面。
 *
 * 地域ブロックを押しただけでは地図へ進まない（Owner実機で「東北6県すべてでも
 * ピンが多く見づらい」と確認されたため）。地域 → 県（複数選択可）→ 地図 の
 * 2段階にし、「◯◯すべてを見る」を明示的に押したときだけ地域まるごとを表示する。
 *
 * 地方・都道府県の定義は types.ts（AREAS / AREA_BY_PREFECTURE）を唯一の出どころと
 * し、この画面では二重管理しない。県の並びも既存の PREFECTURES の順に従う。
 * 選択は確定するまでこの画面のローカルな下書き（draft）に置き、確定操作をするまで
 * アプリ側の絞り込み状態には反映しない（「変更せずに戻る」で元の表示範囲が変わらない）。
 */
export default function RegionLanding({
  areas,
  statByPref,
  totalStations,
  selectedPrefectures,
  onCommit,
  onCancel,
}: Props) {
  const [step, setStep] = useState<Step>({ kind: 'region' });
  const [draft, setDraft] = useState<Prefecture[]>(selectedPrefectures);

  const toggleDraft = (p: Prefecture) =>
    setDraft((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  /** 地域ブロックを選ぶ: 地図へは進まず県選択へ。既に選んでいる県はその地域ぶんだけ引き継ぐ */
  const openArea = (area: AreaName) => {
    setDraft(prefecturesInArea(area).filter((p) => selectedPrefectures.includes(p)));
    setStep({ kind: 'area', area });
  };

  const openAllPrefectures = () => {
    setDraft(selectedPrefectures);
    setStep({ kind: 'all' });
  };

  const backToRegion = () => setStep({ kind: 'region' });

  if (step.kind === 'area') {
    const area = step.area;
    const areaStat = areas.find((a) => a.area === area);
    const prefs = prefecturesInArea(area);
    return (
      <div className="region-landing" data-testid="region-landing">
        <div className="region-landing-inner">
          <button className="region-landing-back" onClick={backToRegion} data-testid="region-landing-back">
            ← 地域を選び直す
          </button>
          <h1 className="region-landing-title" data-testid="region-landing-area-title">
            何県を回りますか？
          </h1>
          <p className="region-landing-lead">
            {area}の道の駅{areaStat ? `（${areaStat.total}駅）` : ''}
            。回る県を選んでください。複数選べます。
          </p>

          <div className="area-pref-grid" data-testid="area-prefecture-grid">
            {prefs.map((pref) => {
              const stat = statByPref.get(pref);
              const active = draft.includes(pref);
              return (
                <button
                  key={pref}
                  className={`area-pref-card${active ? ' active' : ''}`}
                  aria-pressed={active}
                  onClick={() => toggleDraft(pref)}
                  data-testid={`area-pref-${pref}`}
                >
                  <span className="area-pref-check" aria-hidden="true">
                    {active ? '✓' : ''}
                  </span>
                  <span className="area-pref-name">{pref}</span>
                  <span className="area-pref-count">{stat ? `${stat.total}駅` : ''}</span>
                </button>
              );
            })}
          </div>

          <p className="region-landing-selected" data-testid="area-prefecture-selected">
            {draft.length === 0 ? '県が選ばれていません' : `選択中：${draft.join('・')}（${draft.length}県）`}
          </p>

          <button
            className="btn-primary region-landing-confirm"
            disabled={draft.length === 0}
            onClick={() => onCommit(draft)}
            data-testid="area-prefecture-confirm"
          >
            {draft.length === 0 ? '県を選んでください' : `この${draft.length}県で地図を見る`}
          </button>

          <button
            className="region-landing-nationwide"
            onClick={() => onCommit(prefs)}
            data-testid="area-select-all"
          >
            {area}すべてを見る（{areaStat ? `${areaStat.total}駅` : `${prefs.length}県`}）
          </button>
        </div>
      </div>
    );
  }

  if (step.kind === 'all') {
    return (
      <div className="region-landing" data-testid="region-landing">
        <div className="region-landing-inner">
          <button className="region-landing-back" onClick={backToRegion} data-testid="region-landing-back">
            ← 地域を選び直す
          </button>
          <h1 className="region-landing-title">都道府県から選ぶ</h1>
          <p className="region-landing-lead">回る県を選んでください。複数選べます。</p>

          <div className="region-landing-pref" data-testid="region-landing-prefecture">
            <PrefectureChipGroups
              areas={areas}
              statByPref={statByPref}
              selectedPrefectures={draft}
              onToggle={toggleDraft}
              testIdPrefix="region-pref-"
              containerTestId="region-prefecture-groups"
            />
          </div>

          <p className="region-landing-selected" data-testid="region-prefecture-selected">
            {draft.length === 0 ? '県が選ばれていません' : `選択中：${draft.join('・')}（${draft.length}県）`}
          </p>

          <button
            className="btn-primary region-landing-confirm"
            disabled={draft.length === 0}
            onClick={() => onCommit(draft)}
            data-testid="region-landing-prefecture-confirm"
          >
            {draft.length === 0 ? '都道府県を選んでください' : `この${draft.length}県で地図を見る`}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="region-landing" data-testid="region-landing">
      <div className="region-landing-inner">
        <h1 className="region-landing-title">どこを旅しますか？</h1>
        <p className="region-landing-lead">
          まず旅する地域を選び、次に回る県を選びます。選んだ県の道の駅だけを地図に表示します。あとからいつでも変更できます。
        </p>

        <div className="region-card-grid" data-testid="region-card-grid">
          {areas.map((a) => (
            <button
              key={a.area}
              className="region-card"
              onClick={() => openArea(a.area)}
              data-testid={`region-card-${a.area}`}
            >
              <span className="region-card-name">{a.area}</span>
              <span className="region-card-count">{a.total}駅</span>
            </button>
          ))}
        </div>

        <button
          className="region-landing-pref-toggle"
          onClick={openAllPrefectures}
          data-testid="region-landing-prefecture-toggle"
        >
          ▶ 都道府県から選ぶ（全国47県・複数選択できます）
        </button>

        <button
          className="region-landing-nationwide"
          onClick={() => onCommit([])}
          data-testid="region-landing-nationwide"
        >
          全国を見る（{totalStations}駅）
        </button>

        {onCancel && (
          <button className="region-landing-cancel" onClick={onCancel} data-testid="region-landing-cancel">
            変更せずに地図へ戻る
          </button>
        )}
      </div>
    </div>
  );
}
