/**
 * データテスト（仕様§17）: マスターデータの整合性を自動検証する。
 */
import { describe, expect, it } from 'vitest';
import { STATIONS, DATA_META, countsByPref } from './index';
import { PREFECTURES } from '../types';
import { haversineKm } from '../lib/geo';
import { stationSearchUrl } from '../lib/gmaps';
import { isRoutable } from '../lib/planner';

describe('道の駅マスターデータ', () => {
  it('IDの重複がない', () => {
    const ids = STATIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('道の駅名が空ではない', () => {
    for (const s of STATIONS) expect(s.name.trim().length, s.id).toBeGreaterThan(0);
  });

  it('都道府県が東北6県のいずれか', () => {
    for (const s of STATIONS) expect(PREFECTURES).toContain(s.pref);
  });

  it('住所が空ではなく都道府県名で始まる', () => {
    for (const s of STATIONS) {
      expect(s.address.trim().length, s.id).toBeGreaterThan(5);
      expect(s.address.startsWith(s.pref), `${s.id} ${s.address}`).toBe(true);
    }
  });

  it('市区町村が空ではない', () => {
    for (const s of STATIONS) expect(s.city.trim().length, `${s.id} ${s.name}`).toBeGreaterThan(0);
  });

  it('緯度・経度が数値として妥当', () => {
    for (const s of STATIONS) {
      expect(typeof s.lat).toBe('number');
      expect(typeof s.lng).toBe('number');
      expect(Number.isFinite(s.lat)).toBe(true);
      expect(Number.isFinite(s.lng)).toBe(true);
    }
  });

  it('東北地方から明らかに外れた座標がない', () => {
    for (const s of STATIONS) {
      expect(s.lat, `${s.name} lat`).toBeGreaterThan(36.7);
      expect(s.lat, `${s.name} lat`).toBeLessThan(41.7);
      expect(s.lng, `${s.name} lng`).toBeGreaterThan(139.0);
      expect(s.lng, `${s.name} lng`).toBeLessThan(142.3);
    }
  });

  it('同一座標の不自然な使い回しがない', () => {
    const seen = new Map<string, string>();
    for (const s of STATIONS) {
      const key = `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`;
      expect(seen.has(key), `${s.name} と ${seen.get(key)} が同一座標`).toBe(false);
      seen.set(key, s.name);
    }
  });

  it('同一施設の重複登録がない（近接500m以内に同名駅なし）', () => {
    for (let i = 0; i < STATIONS.length; i++) {
      for (let j = i + 1; j < STATIONS.length; j++) {
        const a = STATIONS[i];
        const b = STATIONS[j];
        if (a.name === b.name) {
          // 同名は不可（上下線は名称で区別されている前提）
          expect(a.name, `重複名: ${a.id}/${b.id}`).not.toBe(b.name);
        }
        if (haversineKm(a, b) < 0.15) {
          throw new Error(`近接重複の疑い: ${a.name}(${a.id}) と ${b.name}(${b.id})`);
        }
      }
    }
  });

  it('公式URL・情報URLの形式が妥当', () => {
    for (const s of STATIONS) {
      expect(s.infoUrl, s.id).toMatch(/^https?:\/\/.+/);
      if (s.officialUrl) expect(s.officialUrl, s.id).toMatch(/^https?:\/\/.+/);
    }
  });

  it('GoogleマップURLを生成できる', () => {
    for (const s of STATIONS) {
      const url = stationSearchUrl(s);
      expect(url).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
      expect(decodeURIComponent(url)).toContain(s.name);
    }
  });

  it('県別件数の合計が全体件数と一致し、メタ情報とも一致する', () => {
    const counts = countsByPref();
    const sum = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(sum).toBe(STATIONS.length);
    expect(STATIONS.length).toBe(DATA_META.facilityCount);
    for (const p of PREFECTURES) {
      expect(counts[p], p).toBe((DATA_META.countsByPref as Record<string, number>)[p]);
    }
  });

  it('国交省の登録数181駅と施設数の関係が説明されている（安達上下線）', () => {
    expect(DATA_META.registrationCount).toBe(181);
    const adachi = STATIONS.filter((s) => s.name.includes('安達'));
    expect(adachi.length).toBe(2);
    expect(STATIONS.length).toBe(DATA_META.registrationCount + 1);
  });

  it('ダミー・TODO・仮データ・placeholderが残っていない', () => {
    const banned = /TODO|FIXME|dummy|ダミー|placeholder|仮座標|sample|テスト駅/i;
    for (const s of STATIONS) {
      expect(banned.test(s.name), s.name).toBe(false);
      expect(banned.test(s.address), s.address).toBe(false);
    }
  });

  it('開業前施設はルート候補から除外される', () => {
    const pre = STATIONS.filter((s) => s.status === 'pre_open');
    expect(pre.length).toBeGreaterThan(0); // 石川（福島県）
    for (const s of pre) expect(isRoutable(s)).toBe(false);
    const open = STATIONS.filter((s) => s.status === 'open');
    for (const s of open) expect(isRoutable(s)).toBe(true);
  });

  it('データ確認日と情報源が記録されている', () => {
    expect(DATA_META.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(DATA_META.sources.length).toBeGreaterThanOrEqual(3);
    for (const s of STATIONS) {
      expect(s.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(s.sources.length).toBeGreaterThan(0);
    }
  });
});

describe('施設属性データ（RVパーク・温泉）の再発防止フィクスチャ', () => {
  // 初回監査ではrv-park.jpのページネーション未確認によりRVパーク2件(ならは・猪苗代)を
  // 取りこぼし(福島県は22件あり1ページ目の10件しか見ていなかった)、第2回監査でも
  // 「RVパークライト」グレードの三滝堂をさらに取りこぼした(標準の一覧検索2種類のいずれにも
  // 出現しない)。詳細はdocs/FACILITY_DATA.md参照。これらを固定するための回帰テスト。
  function facilitiesOf(name: string) {
    const st = STATIONS.find((s) => s.name === name);
    if (!st) throw new Error(`station not found: ${name}`);
    return st.facilities;
  }

  it('きらら289: RVパーク・温泉ともにyes（住所完全一致・道の駅併設と一次情報に明記）', () => {
    expect(facilitiesOf('きらら289')?.rvPark).toBe('yes');
    expect(facilitiesOf('きらら289')?.onsen).toBe('yes');
  });

  it('ならは: RVパーク・温泉ともにyes（初回監査で取りこぼしていたページネーション2ページ目分）', () => {
    expect(facilitiesOf('ならは')?.rvPark).toBe('yes');
    expect(facilitiesOf('ならは')?.onsen).toBe('yes');
  });

  it('猪苗代: RVパークはyesだが温泉施設フラグはno（併設施設が違う種類）', () => {
    expect(facilitiesOf('猪苗代')?.rvPark).toBe('yes');
    expect(facilitiesOf('猪苗代')?.onsen).toBe('no');
  });

  it('三滝堂: RVパーク(RVパークライト)はyes（標準の一覧検索2種類には出現せず、専用ページ・観光連盟公式ページで発見）', () => {
    // 第2回監査でも取りこぼしていた。標準の都道府県別検索(rv-park.jp)・地方別一覧(kurumatabi.com)
    // のいずれにも出現しない「RVパークライト」グレード。一覧サイトとの一致だけでは
    // 取りこぼしを検出できないことが判明した象徴的なケース（docs/FACILITY_DATA.md セクション6）。
    expect(facilitiesOf('三滝堂')?.rvPark).toBe('yes');
    expect(facilitiesOf('三滝堂')?.rvParkRelation).toBe('integrated');
  });

  it('たかはた: 過去にRVパーク併設だったが現在は提携終了のためno（過去記事だけでyesにしない）', () => {
    expect(facilitiesOf('たかはた')?.rvPark).toBe('no');
  });

  it('寒河江: 住所がほぼ同一のRVパーク(CLAAPIN SAGAE)があるが、隣接する別法人施設のためno・relation=adjacent', () => {
    // 住所は道の駅(919-8)とRVパーク(919-6)でほぼ同一だが、実際は隣接する
    // 児童遊戯施設「クラッピンサガエ」に併設された別施設であり、道の駅自体の運営ではない。
    // 「住所がほぼ同じ」だけでyesにせず、relationで根拠を残す（false positive防止）。
    expect(facilitiesOf('寒河江')?.rvPark).toBe('no');
    expect(facilitiesOf('寒河江')?.rvParkRelation).toBe('adjacent');
  });

  it('「隣に別法人運営のRVパークがある」だけの駅はfalse positiveにしない', () => {
    // はしかみ/しちのへ/青の国ふだい/白鷹ヤナ公園は近隣(車で2〜3分)に別施設のRVパークが
    // あるが、道の駅併設ではないためrvPark='no'が正しい（同一市町村・徒歩圏だけでyesにしない）。
    for (const name of ['はしかみ', 'しちのへ', '青の国ふだい', '白鷹ヤナ公園']) {
      expect(facilitiesOf(name)?.rvPark).toBe('no');
      expect(facilitiesOf(name)?.rvParkRelation).toBe('nearby');
    }
  });

  it('facilitiesが未収録の駅は存在しない（全182施設に収録済み）', () => {
    const missing = STATIONS.filter((s) => !s.facilities);
    expect(missing.map((s) => s.id)).toEqual([]);
  });

  it('RV_PARK_COUNT=4・ONSEN_COUNT=21・BOTH_COUNT=2・UNKNOWN=0（第3回監査後の確定値）', () => {
    expect(STATIONS.filter((s) => s.facilities?.rvPark === 'yes')).toHaveLength(4);
    expect(STATIONS.filter((s) => s.facilities?.onsen === 'yes')).toHaveLength(21);
    expect(STATIONS.filter((s) => s.facilities?.rvPark === 'yes' && s.facilities?.onsen === 'yes')).toHaveLength(2);
    expect(STATIONS.filter((s) => s.facilities?.rvPark === 'unknown' || s.facilities?.onsen === 'unknown')).toHaveLength(0);
  });
});
