/**
 * データテスト（仕様§17）: マスターデータの整合性を自動検証する。
 */
import { describe, expect, it } from 'vitest';
import { STATIONS, DATA_META, countsByPref } from './index';
import { PREFECTURES, AREA_BY_PREFECTURE } from '../types';
import { haversineKm } from '../lib/geo';
import { stationSearchUrl } from '../lib/gmaps';
import { isRoutable } from '../lib/planner';
import { toNationwideStation } from '../product/station/nationwideStation';

describe('道の駅マスターデータ', () => {
  it('IDの重複がない', () => {
    const ids = STATIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('道の駅名が空ではない', () => {
    for (const s of STATIONS) expect(s.name.trim().length, s.id).toBeGreaterThan(0);
  });

  it('都道府県が収録対象都道府県のいずれか', () => {
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

  it('登録地方から明らかに外れた座標がない（都道府県ごとの想定範囲でチェック）', () => {
    const REGION_BOUNDS: Record<string, { lat: [number, number]; lng: [number, number] }> = {
      北海道: { lat: [41.3, 45.7], lng: [139.3, 146.0] },
      東北: { lat: [36.7, 41.7], lng: [139.0, 142.3] },
      関東: { lat: [34.8, 37.2], lng: [138.5, 140.8] },
      北陸: { lat: [35.2, 38.5], lng: [135.4, 139.7] },
      // 中部(山梨・長野・岐阜・静岡・愛知)は県境・山間部が多く、実際の行政界が
      // 単純な緯度経度の矩形に収まらないため、実データ(最西端・最東端等)を
      // 踏まえてやや広めに取る。県外座標の機械的誤検知を避ける目的の粗い範囲であり、
      // 個別駅の正確な位置は一次情報(michi-no-eki.jp個別ページ)で確認済み。
      中部: { lat: [34.5, 37.1], lng: [136.2, 139.2] },
      // 近畿(三重・滋賀・京都・大阪・兵庫・奈良・和歌山)も府県境・山間部が多いため、
      // 実データ(最北=兵庫県北部、最南=和歌山県南部、最西=兵庫県西部、
      // 最東=三重県東部)を踏まえてやや広めに取る。
      近畿: { lat: [33.3, 35.9], lng: [134.2, 137.0] },
      // 中国地方(鳥取・島根・岡山・広島・山口)も県境・山間部が多く、日本海側・瀬戸内側
      // 双方に跨るため、実データ(最北=島根県隠岐諸島を除く本土最北、最南=瀬戸内沿岸、
      // 最西=山口県西端、最東=岡山・兵庫県境)を踏まえてやや広めに取る。
      中国: { lat: [33.6, 35.7], lng: [130.7, 134.5] },
    };
    for (const s of STATIONS) {
      const region = AREA_BY_PREFECTURE[s.pref];
      const b = REGION_BOUNDS[region];
      expect(b, `${s.pref}の想定範囲が未定義`).toBeDefined();
      expect(s.lat, `${s.name} lat`).toBeGreaterThan(b.lat[0]);
      expect(s.lat, `${s.name} lat`).toBeLessThan(b.lat[1]);
      expect(s.lng, `${s.name} lng`).toBeGreaterThan(b.lng[0]);
      expect(s.lng, `${s.name} lng`).toBeLessThan(b.lng[1]);
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

  it('同一施設の重複登録がない（近接150m以内、または同一都道府県内の同名駅なし）', () => {
    // 全国化により「境(茨城)」「坂井(福井)」がどちらも「さかい」と読むような、
    // 別地域・別実在施設の同音異字/同音同名は正当にあり得る（重複登録ではない）。
    // 一方、同一都道府県内での同名は上下線等を除き基本的に想定しないため、
    // 実際の二重登録を検出する目的では「同一都道府県内の同名」または
    // 「近接150m以内」を重複の判定基準とする。
    for (let i = 0; i < STATIONS.length; i++) {
      for (let j = i + 1; j < STATIONS.length; j++) {
        const a = STATIONS[i];
        const b = STATIONS[j];
        if (a.name === b.name && a.pref === b.pref) {
          // 同一県内の同名は不可（上下線は名称で区別されている前提）
          expect(a.name, `同一県内の重複名: ${a.id}/${b.id}`).not.toBe(b.name);
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

  it('国交省の登録数と施設数の関係が説明されている（安達上下線=東北181+北海道128+関東130+北陸105+中部178+近畿158+中国108登録、東北のみ+1施設）', () => {
    expect(DATA_META.registrationCount).toBe(181 + 128 + 130 + 105 + 178 + 158 + 108);
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

  it('東北6県はfacilitiesが全駅収録済み（北海道は今回のデータ追加では未監査=unknown扱いのため対象外）', () => {
    const tohoku = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '東北');
    const missing = tohoku.filter((s) => !s.facilities);
    expect(missing.map((s) => s.id)).toEqual([]);
    expect(tohoku.length).toBe(182);
  });

  it('北海道はfacilities未監査のためundefined（=unknown扱い、no扱いにしない）', () => {
    const hokkaido = STATIONS.filter((s) => s.pref === '北海道');
    expect(hokkaido.length).toBe(128);
    for (const s of hokkaido) expect(s.facilities, s.id).toBeUndefined();
  });

  it('RV_PARK_COUNT=4・ONSEN_COUNT=21・BOTH_COUNT=2・UNKNOWN=0（第3回監査後の確定値、北海道追加後も東北分の値は不変）', () => {
    expect(STATIONS.filter((s) => s.facilities?.rvPark === 'yes')).toHaveLength(4);
    expect(STATIONS.filter((s) => s.facilities?.onsen === 'yes')).toHaveLength(21);
    expect(STATIONS.filter((s) => s.facilities?.rvPark === 'yes' && s.facilities?.onsen === 'yes')).toHaveLength(2);
    expect(STATIONS.filter((s) => s.facilities?.rvPark === 'unknown' || s.facilities?.onsen === 'unknown')).toHaveLength(0);
  });
});

describe('北海道追加（販売版・全国展開Phase 1）', () => {
  const hokkaido = STATIONS.filter((s) => s.pref === '北海道');
  const tohoku = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '東北');

  it('北海道128駅・東北182駅が両方とも収録されている', () => {
    expect(hokkaido.length).toBe(128);
    expect(tohoku.length).toBe(182);
  });

  it('北海道の駅は全国化アダプタ(product/station)でも例外なく変換でき、地方(region)が正しく解決される', () => {
    for (const s of hokkaido) {
      const n = toNationwideStation(s);
      expect(n.regionId, s.name).toBe('hokkaido');
      expect(n.prefectureCode, s.name).toBe('01');
    }
  });

  it('主要エリアの代表駅が正しく収録されている（札幌近郊・道央・道南・道北・道東）', () => {
    const byName = new Map(hokkaido.map((s) => [s.name, s]));
    // 札幌近郊
    expect(byName.get('サーモンパーク千歳')?.city).toBe('千歳市');
    expect(byName.get('花ロードえにわ')?.city).toBe('恵庭市');
    // 道央
    expect(byName.get('三笠')?.city).toBe('三笠市');
    // 道南
    expect(byName.get('江差')?.city).toBe('江差町');
    expect(byName.get('北前船 松前')?.city).toBe('松前町');
    // 道北
    expect(byName.get('わっかない')?.city).toBe('稚内市');
    // 道東
    expect(byName.get('流氷街道網走')?.city).toBe('網走市');
    expect(byName.get('スワン44ねむろ')?.city).toBe('根室市');
  });

  it('登録取消済み（足寄湖・まるせっぷ・フォーレスト276大滝）は収録しない', () => {
    for (const name of ['足寄湖', 'まるせっぷ', 'フォーレスト276大滝']) {
      expect(hokkaido.find((s) => s.name === name)).toBeUndefined();
    }
  });
});

describe('関東追加（販売版・全国展開Phase 2）', () => {
  const KANTO_PREFS = ['茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県'] as const;
  const kanto = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '関東');
  const hokkaido = STATIONS.filter((s) => s.pref === '北海道');
  const tohoku = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '東北');

  it('北海道128・東北182・関東130がそれぞれ収録されている', () => {
    expect(hokkaido.length).toBe(128);
    expect(tohoku.length).toBe(182);
    expect(kanto.length).toBe(130);
  });

  it('関東は現在のproduct地方マスター定義どおり7都県（茨城・栃木・群馬・埼玉・千葉・東京・神奈川）', () => {
    const prefsPresent = [...new Set(kanto.map((s) => s.pref))].sort();
    expect(prefsPresent).toEqual([...KANTO_PREFS].sort());
    for (const p of KANTO_PREFS) expect(AREA_BY_PREFECTURE[p]).toBe('関東');
  });

  it('都県別内訳: 茨城16・栃木25・群馬33・埼玉21・千葉29・東京1・神奈川5', () => {
    const counts: Record<string, number> = {};
    for (const s of kanto) counts[s.pref] = (counts[s.pref] ?? 0) + 1;
    expect(counts).toEqual({
      茨城県: 16,
      栃木県: 25,
      群馬県: 33,
      埼玉県: 21,
      千葉県: 29,
      東京都: 1,
      神奈川県: 5,
    });
  });

  it('関東の駅は全国化アダプタ(product/station)でも例外なく変換でき、地方(region)が正しく解決される', () => {
    for (const s of kanto) {
      const n = toNationwideStation(s);
      expect(n.regionId, s.name).toBe('kanto');
    }
  });

  it('関東facilitiesは今回未監査のためundefined（=unknown扱い、no扱いにしない）', () => {
    for (const s of kanto) expect(s.facilities, s.id).toBeUndefined();
  });

  it('東北facility確定値(RV=4・温泉=21・BOTH=2)は関東追加後も不変', () => {
    expect(STATIONS.filter((s) => s.facilities?.rvPark === 'yes')).toHaveLength(4);
    expect(STATIONS.filter((s) => s.facilities?.onsen === 'yes')).toHaveLength(21);
    expect(STATIONS.filter((s) => s.facilities?.rvPark === 'yes' && s.facilities?.onsen === 'yes')).toHaveLength(2);
  });

  it('都市部・郊外・山間部を含む代表駅が正しく収録されている', () => {
    const byName = new Map(kanto.map((s) => [s.name, s]));
    // 都市部
    expect(byName.get('八王子滝山')?.city).toBe('八王子市');
    expect(byName.get('湘南ちがさき')?.city).toBe('茅ヶ崎市');
    // 郊外
    expect(byName.get('川場田園プラザ')?.city).toBe('利根郡川場村');
    expect(byName.get('しょうなん')?.city).toBe('柏市');
    // 山間部
    expect(byName.get('両神温泉薬師の湯')?.city).toBe('秩父郡小鹿野町');
    expect(byName.get('箱根峠')?.city).toBe('足柄下郡箱根町');
  });
});

describe('北陸追加（販売版・全国展開Phase 3）', () => {
  const HOKURIKU_PREFS = ['新潟県', '富山県', '石川県', '福井県'] as const;
  const hokuriku = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '北陸');
  const hokkaido = STATIONS.filter((s) => s.pref === '北海道');
  const tohoku = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '東北');
  const kanto = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '関東');

  it('北海道128・東北182・関東130・北陸105の4地域が収録されている（中部追加後も既存4地域件数は不変）', () => {
    expect(hokkaido.length).toBe(128);
    expect(tohoku.length).toBe(182);
    expect(kanto.length).toBe(130);
    expect(hokuriku.length).toBe(105);
  });

  it('北陸は現在のproduct地方マスター定義どおり4県（新潟・富山・石川・福井）', () => {
    const prefsPresent = [...new Set(hokuriku.map((s) => s.pref))].sort();
    expect(prefsPresent).toEqual([...HOKURIKU_PREFS].sort());
    for (const p of HOKURIKU_PREFS) expect(AREA_BY_PREFECTURE[p]).toBe('北陸');
  });

  it('県別内訳: 新潟42・富山16・石川26・福井21', () => {
    const counts: Record<string, number> = {};
    for (const s of hokuriku) counts[s.pref] = (counts[s.pref] ?? 0) + 1;
    expect(counts).toEqual({
      新潟県: 42,
      富山県: 16,
      石川県: 26,
      福井県: 21,
    });
  });

  it('全駅で駅IDが衝突しない（michi-no-eki.jpの全国一意ID採用）', () => {
    const ids = STATIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('全駅で座標が数値かつ重複がない（同一地点の異なる駅が存在しない）', () => {
    const seen = new Map<string, string>();
    for (const s of STATIONS) {
      expect(Number.isFinite(s.lat), s.name).toBe(true);
      expect(Number.isFinite(s.lng), s.name).toBe(true);
      const key = `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`;
      expect(seen.has(key), `${s.name} と ${seen.get(key)} が同一座標`).toBe(false);
      seen.set(key, s.name);
    }
  });

  it('「さかい」（茨城県境町・福井県坂井市）は異なる実在施設の同音同名であり、重複登録ではない', () => {
    const sakai = STATIONS.filter((s) => s.name === 'さかい');
    expect(sakai.length).toBe(2);
    expect(sakai.map((s) => s.pref).sort()).toEqual(['福井県', '茨城県']);
    expect(haversineKm(sakai[0], sakai[1])).toBeGreaterThan(10); // 別施設であることを距離でも確認
  });

  it('北陸の駅は全国化アダプタ(product/station)でも例外なく変換でき、地方(region)が正しく解決される', () => {
    for (const s of hokuriku) {
      const n = toNationwideStation(s);
      expect(n.regionId, s.name).toBe('hokuriku');
    }
  });

  it('北陸facilitiesは今回未監査のためundefined（=unknown扱い、no扱いにしない）', () => {
    for (const s of hokuriku) expect(s.facilities, s.id).toBeUndefined();
  });

  it('東北facility確定値(RV=4・温泉=21・BOTH=2)は北陸追加後も不変', () => {
    expect(STATIONS.filter((s) => s.facilities?.rvPark === 'yes')).toHaveLength(4);
    expect(STATIONS.filter((s) => s.facilities?.onsen === 'yes')).toHaveLength(21);
    expect(STATIONS.filter((s) => s.facilities?.rvPark === 'yes' && s.facilities?.onsen === 'yes')).toHaveLength(2);
  });

  it('4県の代表駅が正しく収録されている', () => {
    const byName = new Map(hokuriku.map((s) => [s.name, s]));
    expect(byName.get('うみてらす名立')?.pref).toBe('新潟県');
    expect(byName.get('KOKOくろべ')?.pref).toBe('富山県');
    expect(byName.get('めぐみ白山')?.pref).toBe('石川県');
    expect(byName.get('若狭おばま')?.pref).toBe('福井県');
  });
});

describe('中部追加（販売版・全国展開Phase 4）', () => {
  const CHUBU_PREFS = ['山梨県', '長野県', '岐阜県', '静岡県', '愛知県'] as const;
  const chubu = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '中部');
  const hokkaido = STATIONS.filter((s) => s.pref === '北海道');
  const tohoku = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '東北');
  const kanto = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '関東');
  const hokuriku = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '北陸');

  it('北海道128・東北182・関東130・北陸105・中部178の5地域が収録されている（近畿追加後も既存5地域件数は不変）', () => {
    expect(hokkaido.length).toBe(128);
    expect(tohoku.length).toBe(182);
    expect(kanto.length).toBe(130);
    expect(hokuriku.length).toBe(105);
    expect(chubu.length).toBe(178);
  });

  it('中部は現在のproduct地方マスター定義どおり5県（山梨・長野・岐阜・静岡・愛知）', () => {
    const prefsPresent = [...new Set(chubu.map((s) => s.pref))].sort();
    expect(prefsPresent).toEqual([...CHUBU_PREFS].sort());
    for (const p of CHUBU_PREFS) expect(AREA_BY_PREFECTURE[p]).toBe('中部');
  });

  it('県別内訳: 山梨22・長野54・岐阜55・静岡28・愛知19', () => {
    const counts: Record<string, number> = {};
    for (const s of chubu) counts[s.pref] = (counts[s.pref] ?? 0) + 1;
    expect(counts).toEqual({
      山梨県: 22,
      長野県: 54,
      岐阜県: 55,
      静岡県: 28,
      愛知県: 19,
    });
  });

  it('全駅で駅IDが衝突しない・座標が重複しない（中部追加後も5地域共存で成立）', () => {
    const ids = STATIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const seen = new Map<string, string>();
    for (const s of STATIONS) {
      const key = `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`;
      expect(seen.has(key), `${s.name} と ${seen.get(key)} が同一座標`).toBe(false);
      seen.set(key, s.name);
    }
  });

  it('中部の駅は全国化アダプタ(product/station)でも例外なく変換でき、地方(region)が正しく解決される', () => {
    for (const s of chubu) {
      const n = toNationwideStation(s);
      expect(n.regionId, s.name).toBe('chubu');
    }
  });

  it('中部facilitiesは今回未監査のためundefined（=unknown扱い、no扱いにしない）', () => {
    for (const s of chubu) expect(s.facilities, s.id).toBeUndefined();
  });

  it('東北facility確定値(RV=4・温泉=21・BOTH=2)は中部追加後も不変', () => {
    expect(STATIONS.filter((s) => s.facilities?.rvPark === 'yes')).toHaveLength(4);
    expect(STATIONS.filter((s) => s.facilities?.onsen === 'yes')).toHaveLength(21);
    expect(STATIONS.filter((s) => s.facilities?.rvPark === 'yes' && s.facilities?.onsen === 'yes')).toHaveLength(2);
  });

  it('5県の代表駅が正しく収録されている（都市近郊・山間部・観光地・海側・内陸）', () => {
    const byName = new Map(chubu.map((s) => [s.name, s]));
    expect(byName.get('なるさわ')?.pref).toBe('山梨県'); // 富士五湖・観光地
    expect(byName.get('信州新町')?.pref).toBe('長野県'); // 長野市近郊
    expect(byName.get('パスカル清見')?.pref).toBe('岐阜県'); // 高山市・山間部
    expect(byName.get('富士')?.pref).toBe('静岡県'); // 富士市・都市近郊
    expect(byName.get('田原めっくんはうす')?.pref).toBe('愛知県'); // 渥美半島・海側
  });
});

describe('近畿追加（販売版・全国展開Phase 5）', () => {
  const KINKI_PREFS = ['三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県'] as const;
  const kinki = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '近畿');
  const hokkaido = STATIONS.filter((s) => s.pref === '北海道');
  const tohoku = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '東北');
  const kanto = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '関東');
  const hokuriku = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '北陸');
  const chubu = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '中部');

  it('北海道128・東北182・関東130・北陸105・中部178・近畿158の6地域が収録されている（中国追加後も既存6地域件数は不変）', () => {
    expect(hokkaido.length).toBe(128);
    expect(tohoku.length).toBe(182);
    expect(kanto.length).toBe(130);
    expect(hokuriku.length).toBe(105);
    expect(chubu.length).toBe(178);
    expect(kinki.length).toBe(158);
  });

  it('近畿は現在のproduct地方マスター定義どおり7府県（三重・滋賀・京都・大阪・兵庫・奈良・和歌山）', () => {
    const prefsPresent = [...new Set(kinki.map((s) => s.pref))].sort();
    expect(prefsPresent).toEqual([...KINKI_PREFS].sort());
    for (const p of KINKI_PREFS) expect(AREA_BY_PREFECTURE[p]).toBe('近畿');
  });

  it('府県別内訳: 三重18・滋賀20・京都18・大阪10・兵庫37・奈良18・和歌山37', () => {
    const counts: Record<string, number> = {};
    for (const s of kinki) counts[s.pref] = (counts[s.pref] ?? 0) + 1;
    expect(counts).toEqual({
      三重県: 18,
      滋賀県: 20,
      京都府: 18,
      大阪府: 10,
      兵庫県: 37,
      奈良県: 18,
      和歌山県: 37,
    });
  });

  it('全駅で駅IDが衝突しない・座標が重複しない（近畿追加後も6地域共存で成立）', () => {
    const ids = STATIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const seen = new Map<string, string>();
    for (const s of STATIONS) {
      const key = `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`;
      expect(seen.has(key), `${s.name} と ${seen.get(key)} が同一座標`).toBe(false);
      seen.set(key, s.name);
    }
  });

  it('近畿の駅は全国化アダプタ(product/station)でも例外なく変換でき、地方(region)が正しく解決される', () => {
    for (const s of kinki) {
      const n = toNationwideStation(s);
      expect(n.regionId, s.name).toBe('kinki');
    }
  });

  it('近畿facilitiesは今回未監査のためundefined（=unknown扱い、no扱いにしない）', () => {
    for (const s of kinki) expect(s.facilities, s.id).toBeUndefined();
  });

  it('東北facility確定値(RV=4・温泉=21・BOTH=2)は近畿追加後も不変', () => {
    expect(STATIONS.filter((s) => s.facilities?.rvPark === 'yes')).toHaveLength(4);
    expect(STATIONS.filter((s) => s.facilities?.onsen === 'yes')).toHaveLength(21);
    expect(STATIONS.filter((s) => s.facilities?.rvPark === 'yes' && s.facilities?.onsen === 'yes')).toHaveLength(2);
  });

  it('三重県は今回の全国化マスター(product/region/regions.ts)どおり近畿のまま（中部へは移動しない）', () => {
    expect(AREA_BY_PREFECTURE['三重県']).toBe('近畿');
  });

  it('きなりの郷 下北山（奈良県）は一次情報側の経度入力ミスを補正した座標を採用している', () => {
    const st = kinki.find((s) => s.id === 'mne-22788');
    expect(st).toBeDefined();
    expect(st!.lng).toBeCloseTo(135.9624087621255, 5);
    expect(st!.lng).toBeGreaterThan(122);
    expect(st!.lng).toBeLessThan(146);
  });

  it('7府県の代表駅が正しく収録されている（都市近郊・山間部・観光地・海側・内陸）', () => {
    const byName = new Map(kinki.map((s) => [s.name, s]));
    expect(byName.get('紀宝町ウミガメ公園')?.pref).toBe('三重県'); // 熊野灘・海側
    expect(byName.get('びわ湖大橋米プラザ')?.pref).toBe('滋賀県'); // 大津市・都市近郊
    expect(byName.get('舟屋の里伊根')?.pref).toBe('京都府'); // 丹後・観光地/海側
    expect(byName.get('しらとりの郷・羽曳野')?.pref).toBe('大阪府'); // 羽曳野市・都市近郊
    expect(byName.get('神鍋高原')?.pref).toBe('兵庫県'); // 豊岡市・山間部
    expect(byName.get('吉野路　大塔')?.pref).toBe('奈良県'); // 五條市・山間部
    expect(byName.get('イノブータンランド・すさみ')?.pref).toBe('和歌山県'); // すさみ町・海側
  });
});

describe('中国地方追加（販売版・全国展開Phase 6）', () => {
  const CHUGOKU_PREFS = ['鳥取県', '島根県', '岡山県', '広島県', '山口県'] as const;
  const chugoku = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '中国');
  const hokkaido = STATIONS.filter((s) => s.pref === '北海道');
  const tohoku = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '東北');
  const kanto = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '関東');
  const hokuriku = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '北陸');
  const chubu = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '中部');
  const kinki = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '近畿');

  it('北海道128・東北182・関東130・北陸105・中部178・近畿158・中国108の7地域、合計989駅で共存する', () => {
    expect(hokkaido.length).toBe(128);
    expect(tohoku.length).toBe(182);
    expect(kanto.length).toBe(130);
    expect(hokuriku.length).toBe(105);
    expect(chubu.length).toBe(178);
    expect(kinki.length).toBe(158);
    expect(chugoku.length).toBe(108);
    expect(STATIONS.length).toBe(989);
  });

  it('中国地方は現在のproduct地方マスター定義どおり5県（鳥取・島根・岡山・広島・山口）', () => {
    const prefsPresent = [...new Set(chugoku.map((s) => s.pref))].sort();
    expect(prefsPresent).toEqual([...CHUGOKU_PREFS].sort());
    for (const p of CHUGOKU_PREFS) expect(AREA_BY_PREFECTURE[p]).toBe('中国');
  });

  it('県別内訳: 鳥取17・島根29・岡山17・広島21・山口24', () => {
    const counts: Record<string, number> = {};
    for (const s of chugoku) counts[s.pref] = (counts[s.pref] ?? 0) + 1;
    expect(counts).toEqual({
      鳥取県: 17,
      島根県: 29,
      岡山県: 17,
      広島県: 21,
      山口県: 24,
    });
  });

  it('全駅で駅IDが衝突しない・座標が重複しない（中国追加後も7地域共存で成立）', () => {
    const ids = STATIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const seen = new Map<string, string>();
    for (const s of STATIONS) {
      const key = `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`;
      expect(seen.has(key), `${s.name} と ${seen.get(key)} が同一座標`).toBe(false);
      seen.set(key, s.name);
    }
  });

  it('中国地方の駅は全国化アダプタ(product/station)でも例外なく変換でき、地方(region)が正しく解決される', () => {
    for (const s of chugoku) {
      const n = toNationwideStation(s);
      expect(n.regionId, s.name).toBe('chugoku');
    }
  });

  it('中国地方facilitiesは今回未監査のためundefined（=unknown扱い、no扱いにしない）', () => {
    for (const s of chugoku) expect(s.facilities, s.id).toBeUndefined();
  });

  it('東北facility確定値(RV=4・温泉=21・BOTH=2)は中国追加後も不変', () => {
    expect(STATIONS.filter((s) => s.facilities?.rvPark === 'yes')).toHaveLength(4);
    expect(STATIONS.filter((s) => s.facilities?.onsen === 'yes')).toHaveLength(21);
    expect(STATIONS.filter((s) => s.facilities?.rvPark === 'yes' && s.facilities?.onsen === 'yes')).toHaveLength(2);
  });

  it('一次情報側の住所表記揺れ（都道府県欠落・市区町村欠落・URLプレースホルダー）を正規化している', () => {
    const soleneshunan = chugoku.find((s) => s.id === 'mne-19610');
    expect(soleneshunan?.address.startsWith('山口県')).toBe(true); // 一次情報は「山口県」欠落、市区町村から補完

    const mitsuya = chugoku.find((s) => s.id === 'mne-19952');
    expect(mitsuya?.city).toBe('安芸高田市'); // 一次情報は検索一覧で市区町村欄が空欄

    const hiruzen = chugoku.find((s) => s.id === 'mne-19564');
    expect(hiruzen?.officialUrl).toBeNull(); // 一次情報は「なし」というプレースホルダー文字列
  });

  it('5県の代表駅が正しく収録されている（都市近郊・山間部・観光地・日本海側・瀬戸内側）', () => {
    const byName = new Map(chugoku.map((s) => [s.name, s]));
    expect(byName.get('ポート赤碕')?.pref).toBe('鳥取県'); // 琴浦町・日本海側
    expect(byName.get('ゆうひパーク浜田')?.pref).toBe('島根県'); // 浜田市・日本海側
    expect(byName.get('みやま公園')?.pref).toBe('岡山県'); // 玉野市・瀬戸内側
    expect(byName.get('豊平どんぐり村')?.pref).toBe('広島県'); // 北広島町・山間部
    expect(byName.get('萩往還')?.pref).toBe('山口県'); // 萩市・観光地
  });
});
