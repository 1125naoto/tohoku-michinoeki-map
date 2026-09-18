/**
 * データテスト（仕様§17）: マスターデータの整合性を自動検証する。
 */
import { describe, expect, it } from 'vitest';
import { STATIONS, DATA_META, countsByPref } from './index';
import { PREFECTURES, AREA_BY_PREFECTURE, AREAS } from '../types';
import { haversineKm } from '../lib/geo';
import { stationSearchUrl } from '../lib/gmaps';
import { isRoutable } from '../lib/planner';
import { toNationwideStation } from '../product/station/nationwideStation';
import { prefectureByName, REGION_NAMES } from '../product/region/regions';

/** 東北6県の確定値(RVパーク4・温泉21・両方2)を保護するための共通スコープ。
 * Phase 10の全国監査後も東北分は不変であることを各Phaseのブロックで検証する。 */
const TOHOKU_STATIONS = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '東北');

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
      // 四国(徳島・香川・愛媛・高知)は本州と海を隔てており、離島(小豆島)や
      // 半島先端(佐田岬)まで収録範囲に含む。実データ(最北=香川県小豆島、
      // 最南=高知県土佐清水市、最西=愛媛県佐田岬半島、最東=徳島県阿南市)を
      // 踏まえてやや広めに取る。
      四国: { lat: [32.6, 34.7], lng: [132.1, 134.8] },
      // 九州(福岡・佐賀・長崎・熊本・大分・宮崎・鹿児島)は離島を多く含む。
      // 実データ(最南=鹿児島県徳之島、最北=福岡県宗像市、最西=長崎県五島列島、
      // 最東=大分県佐伯市)を踏まえてやや広めに取る。沖縄は本Phaseの対象外。
      九州: { lat: [27.0, 34.2], lng: [128.3, 132.3] },
      // 沖縄(本島)。収録10駅はいずれも沖縄本島に所在する。
      沖縄: { lat: [26.0, 26.9], lng: [127.5, 128.4] },
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

  it('国交省の登録数と施設数の関係が説明されている（全国1,234登録 + 上下線で2施設になる3登録 = 1,237施設）', () => {
    // 全国再突合の結果、国土交通省「道の駅」一覧(令和8年9月4日現在)の登録数は1,234件。
    // うち3件は上下線などで施設が2つに分かれており、本データは施設単位で保持する。
    expect(DATA_META.registrationCount).toBe(1234);
    const dualFacility = ['安達', '宇津ノ谷峠', 'かつらぎ西'];
    for (const name of dualFacility) {
      expect(STATIONS.filter((s) => s.name.includes(name)), name).toHaveLength(2);
    }
    expect(STATIONS.length).toBe(DATA_META.registrationCount + dualFacility.length);
    expect(STATIONS.length).toBe(DATA_META.facilityCount);
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

  it('北海道もPhase 10の全国監査で確定済み（値はyes/no/unknownのいずれか、undefinedではない）', () => {
    const hokkaido = STATIONS.filter((s) => s.pref === '北海道');
    expect(hokkaido.length).toBe(128);
    for (const s of hokkaido) {
      expect(s.facilities, s.id).toBeDefined();
      expect(['yes', 'no', 'unknown'], s.id).toContain(s.facilities!.rvPark);
      expect(['yes', 'no', 'unknown'], s.id).toContain(s.facilities!.onsen);
    }
  });

  it('東北のRV_PARK_COUNT=4・ONSEN_COUNT=21・BOTH_COUNT=2・UNKNOWN=0（第3回監査の確定値はPhase 10の全国監査後も不変）', () => {
    expect(TOHOKU_STATIONS.filter((s) => s.facilities?.rvPark === 'yes')).toHaveLength(4);
    expect(TOHOKU_STATIONS.filter((s) => s.facilities?.onsen === 'yes')).toHaveLength(21);
    expect(TOHOKU_STATIONS.filter((s) => s.facilities?.rvPark === 'yes' && s.facilities?.onsen === 'yes')).toHaveLength(2);
    // 東北は施設条件検索で悉皆確認済みのため、unknownは1件も残らない
    expect(
      TOHOKU_STATIONS.filter((s) => s.facilities?.rvPark === 'unknown' || s.facilities?.onsen === 'unknown')
    ).toHaveLength(0);
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

  it('北海道128・東北182・関東131がそれぞれ収録されている', () => {
    expect(hokkaido.length).toBe(128);
    expect(tohoku.length).toBe(182);
    expect(kanto.length).toBe(131); // 全国再突合(Phase 9)で「やどりきテラス清流の里」を追加
  });

  it('関東は現在のproduct地方マスター定義どおり7都県（茨城・栃木・群馬・埼玉・千葉・東京・神奈川）', () => {
    const prefsPresent = [...new Set(kanto.map((s) => s.pref))].sort();
    expect(prefsPresent).toEqual([...KANTO_PREFS].sort());
    for (const p of KANTO_PREFS) expect(AREA_BY_PREFECTURE[p]).toBe('関東');
  });

  it('都県別内訳: 茨城16・栃木25・群馬33・埼玉21・千葉29・東京1・神奈川6（神奈川はPhase 9の全国再突合で5→6）', () => {
    const counts: Record<string, number> = {};
    for (const s of kanto) counts[s.pref] = (counts[s.pref] ?? 0) + 1;
    expect(counts).toEqual({
      茨城県: 16,
      栃木県: 25,
      群馬県: 33,
      埼玉県: 21,
      千葉県: 29,
      東京都: 1,
      神奈川県: 6,
    });
  });

  it('関東の駅は全国化アダプタ(product/station)でも例外なく変換でき、地方(region)が正しく解決される', () => {
    for (const s of kanto) {
      const n = toNationwideStation(s);
      expect(n.regionId, s.name).toBe('kanto');
    }
  });

  it('関東facilitiesはPhase 10の全国監査で確定済み（値はyes/no/unknownのいずれか、undefinedではない）', () => {
    for (const s of kanto) {
      expect(s.facilities, s.id).toBeDefined();
      expect(['yes', 'no', 'unknown'], s.id).toContain(s.facilities!.rvPark);
      expect(['yes', 'no', 'unknown'], s.id).toContain(s.facilities!.onsen);
    }
  });

  it('東北facility確定値(RV=4・温泉=21・BOTH=2)は関東追加後も不変', () => {
    expect(TOHOKU_STATIONS.filter((s) => s.facilities?.rvPark === 'yes')).toHaveLength(4);
    expect(TOHOKU_STATIONS.filter((s) => s.facilities?.onsen === 'yes')).toHaveLength(21);
    expect(TOHOKU_STATIONS.filter((s) => s.facilities?.rvPark === 'yes' && s.facilities?.onsen === 'yes')).toHaveLength(2);
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

  it('北海道128・東北182・関東131・北陸105の4地域が収録されている（中部追加後も既存4地域件数は不変）', () => {
    expect(hokkaido.length).toBe(128);
    expect(tohoku.length).toBe(182);
    expect(kanto.length).toBe(131); // 全国再突合(Phase 9)で「やどりきテラス清流の里」を追加
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

  it('北陸facilitiesはPhase 10の全国監査で確定済み（値はyes/no/unknownのいずれか、undefinedではない）', () => {
    for (const s of hokuriku) {
      expect(s.facilities, s.id).toBeDefined();
      expect(['yes', 'no', 'unknown'], s.id).toContain(s.facilities!.rvPark);
      expect(['yes', 'no', 'unknown'], s.id).toContain(s.facilities!.onsen);
    }
  });

  it('東北facility確定値(RV=4・温泉=21・BOTH=2)は北陸追加後も不変', () => {
    expect(TOHOKU_STATIONS.filter((s) => s.facilities?.rvPark === 'yes')).toHaveLength(4);
    expect(TOHOKU_STATIONS.filter((s) => s.facilities?.onsen === 'yes')).toHaveLength(21);
    expect(TOHOKU_STATIONS.filter((s) => s.facilities?.rvPark === 'yes' && s.facilities?.onsen === 'yes')).toHaveLength(2);
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

  it('北海道128・東北182・関東131・北陸105・中部178の5地域が収録されている（近畿追加後も既存5地域件数は不変）', () => {
    expect(hokkaido.length).toBe(128);
    expect(tohoku.length).toBe(182);
    expect(kanto.length).toBe(131); // 全国再突合(Phase 9)で「やどりきテラス清流の里」を追加
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

  it('中部facilitiesはPhase 10の全国監査で確定済み（値はyes/no/unknownのいずれか、undefinedではない）', () => {
    for (const s of chubu) {
      expect(s.facilities, s.id).toBeDefined();
      expect(['yes', 'no', 'unknown'], s.id).toContain(s.facilities!.rvPark);
      expect(['yes', 'no', 'unknown'], s.id).toContain(s.facilities!.onsen);
    }
  });

  it('東北facility確定値(RV=4・温泉=21・BOTH=2)は中部追加後も不変', () => {
    expect(TOHOKU_STATIONS.filter((s) => s.facilities?.rvPark === 'yes')).toHaveLength(4);
    expect(TOHOKU_STATIONS.filter((s) => s.facilities?.onsen === 'yes')).toHaveLength(21);
    expect(TOHOKU_STATIONS.filter((s) => s.facilities?.rvPark === 'yes' && s.facilities?.onsen === 'yes')).toHaveLength(2);
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

  it('北海道128・東北182・関東131・北陸105・中部178・近畿158の6地域が収録されている（中国追加後も既存6地域件数は不変）', () => {
    expect(hokkaido.length).toBe(128);
    expect(tohoku.length).toBe(182);
    expect(kanto.length).toBe(131); // 全国再突合(Phase 9)で「やどりきテラス清流の里」を追加
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

  it('近畿facilitiesはPhase 10の全国監査で確定済み（値はyes/no/unknownのいずれか、undefinedではない）', () => {
    for (const s of kinki) {
      expect(s.facilities, s.id).toBeDefined();
      expect(['yes', 'no', 'unknown'], s.id).toContain(s.facilities!.rvPark);
      expect(['yes', 'no', 'unknown'], s.id).toContain(s.facilities!.onsen);
    }
  });

  it('東北facility確定値(RV=4・温泉=21・BOTH=2)は近畿追加後も不変', () => {
    expect(TOHOKU_STATIONS.filter((s) => s.facilities?.rvPark === 'yes')).toHaveLength(4);
    expect(TOHOKU_STATIONS.filter((s) => s.facilities?.onsen === 'yes')).toHaveLength(21);
    expect(TOHOKU_STATIONS.filter((s) => s.facilities?.rvPark === 'yes' && s.facilities?.onsen === 'yes')).toHaveLength(2);
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

  it('北海道128・東北182・関東131・北陸105・中部178・近畿158・中国108の7地域が収録されている（四国追加後も既存7地域件数は不変）', () => {
    expect(hokkaido.length).toBe(128);
    expect(tohoku.length).toBe(182);
    expect(kanto.length).toBe(131); // 全国再突合(Phase 9)で「やどりきテラス清流の里」を追加
    expect(hokuriku.length).toBe(105);
    expect(chubu.length).toBe(178);
    expect(kinki.length).toBe(158);
    expect(chugoku.length).toBe(108);
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

  it('中国地方facilitiesはPhase 10の全国監査で確定済み（値はyes/no/unknownのいずれか、undefinedではない）', () => {
    for (const s of chugoku) {
      expect(s.facilities, s.id).toBeDefined();
      expect(['yes', 'no', 'unknown'], s.id).toContain(s.facilities!.rvPark);
      expect(['yes', 'no', 'unknown'], s.id).toContain(s.facilities!.onsen);
    }
  });

  it('東北facility確定値(RV=4・温泉=21・BOTH=2)は中国追加後も不変', () => {
    expect(TOHOKU_STATIONS.filter((s) => s.facilities?.rvPark === 'yes')).toHaveLength(4);
    expect(TOHOKU_STATIONS.filter((s) => s.facilities?.onsen === 'yes')).toHaveLength(21);
    expect(TOHOKU_STATIONS.filter((s) => s.facilities?.rvPark === 'yes' && s.facilities?.onsen === 'yes')).toHaveLength(2);
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

describe('四国追加（販売版・全国展開Phase 7）', () => {
  const SHIKOKU_PREFS = ['徳島県', '香川県', '愛媛県', '高知県'] as const;
  const shikoku = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '四国');
  const hokkaido = STATIONS.filter((s) => s.pref === '北海道');
  const tohoku = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '東北');
  const kanto = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '関東');
  const hokuriku = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '北陸');
  const chubu = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '中部');
  const kinki = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '近畿');
  const chugoku = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '中国');

  it('北海道128・東北182・関東131・北陸105・中部178・近畿158・中国108・四国91の8地域が収録されている（九州追加後も既存8地域件数は不変）', () => {
    expect(hokkaido.length).toBe(128);
    expect(tohoku.length).toBe(182);
    expect(kanto.length).toBe(131); // 全国再突合(Phase 9)で「やどりきテラス清流の里」を追加
    expect(hokuriku.length).toBe(105);
    expect(chubu.length).toBe(178);
    expect(kinki.length).toBe(158);
    expect(chugoku.length).toBe(108);
    expect(shikoku.length).toBe(91);
  });

  it('四国は現在のproduct地方マスター定義どおり4県（徳島・香川・愛媛・高知）', () => {
    const prefsPresent = [...new Set(shikoku.map((s) => s.pref))].sort();
    expect(prefsPresent).toEqual([...SHIKOKU_PREFS].sort());
    for (const p of SHIKOKU_PREFS) expect(AREA_BY_PREFECTURE[p]).toBe('四国');
  });

  it('県別内訳: 徳島18・香川18・愛媛29・高知26（国交省一覧XLSの県別件数と一致）', () => {
    const counts: Record<string, number> = {};
    for (const s of shikoku) counts[s.pref] = (counts[s.pref] ?? 0) + 1;
    expect(counts).toEqual({
      徳島県: 18,
      香川県: 18,
      愛媛県: 29,
      高知県: 26,
    });
  });

  it('全駅で駅IDが衝突しない・座標が重複しない（四国追加後も8地域共存で成立）', () => {
    const ids = STATIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const seen = new Map<string, string>();
    for (const s of STATIONS) {
      const key = `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`;
      expect(seen.has(key), `${s.name} と ${seen.get(key)} が同一座標`).toBe(false);
      seen.set(key, s.name);
    }
  });

  it('四国の駅は全国化アダプタ(product/station)でも例外なく変換でき、地方(region)が正しく解決される', () => {
    for (const s of shikoku) {
      const n = toNationwideStation(s);
      expect(n.regionId, s.name).toBe('shikoku');
    }
  });

  it('四国facilitiesはPhase 10の全国監査で確定済み（値はyes/no/unknownのいずれか、undefinedではない）', () => {
    for (const s of shikoku) {
      expect(s.facilities, s.id).toBeDefined();
      expect(['yes', 'no', 'unknown'], s.id).toContain(s.facilities!.rvPark);
      expect(['yes', 'no', 'unknown'], s.id).toContain(s.facilities!.onsen);
    }
  });

  it('東北facility確定値(RV=4・温泉=21・BOTH=2)は四国追加後も不変', () => {
    expect(TOHOKU_STATIONS.filter((s) => s.facilities?.rvPark === 'yes')).toHaveLength(4);
    expect(TOHOKU_STATIONS.filter((s) => s.facilities?.onsen === 'yes')).toHaveLength(21);
    expect(TOHOKU_STATIONS.filter((s) => s.facilities?.rvPark === 'yes' && s.facilities?.onsen === 'yes')).toHaveLength(2);
  });

  it('一次情報側の住所欠落（都道府県名なし）を国交省一覧で裏取りして補完している', () => {
    // 一次情報の所在地は「安芸郡東洋町白浜88−1」で高知県が欠落していた。
    // 国交省「道の駅」一覧の所在地欄（高知県／安芸郡東洋町）で裏取りして補完した。
    const toyocho = shikoku.find((s) => s.id === 'mne-22528');
    expect(toyocho?.address.startsWith('高知県')).toBe(true);
    expect(toyocho?.city).toBe('東洋町');
  });

  it('一次情報のホームページ欄が空だった駅はofficialUrl=null（既存地域と同じ規約、空文字にしない）', () => {
    const noUrl = shikoku.filter((s) => s.officialUrl === null).map((s) => s.id);
    expect(noUrl.sort()).toEqual(['mne-19623', 'mne-19922', 'mne-19975'].sort());
    for (const s of shikoku) expect(s.officialUrl === null || /^https?:\/\//.test(s.officialUrl!), s.id).toBe(true);
  });

  it('四国は本州と海を隔てるが、全駅が四国の実在範囲（離島・半島先端を含む）に収まる', () => {
    for (const s of shikoku) {
      expect(s.lat, `${s.name} lat`).toBeGreaterThan(32.6);
      expect(s.lat, `${s.name} lat`).toBeLessThan(34.7);
      expect(s.lng, `${s.name} lng`).toBeGreaterThan(132.1);
      expect(s.lng, `${s.name} lng`).toBeLessThan(134.8);
    }
  });

  it('4県の代表駅が正しく収録されている（瀬戸内側・太平洋側・山間部・離島・半島先端）', () => {
    const byName = new Map(shikoku.map((s) => [s.name, s]));
    expect(byName.get('第九の里')?.pref).toBe('徳島県'); // 鳴門市・瀬戸内側
    expect(byName.get('大歩危')?.pref).toBe('徳島県'); // 三好市・山間部
    expect(byName.get('小豆島オリーブ公園')?.pref).toBe('香川県'); // 小豆島・離島
    expect(byName.get('佐田岬半島ミュージアム')?.pref).toBe('愛媛県'); // 伊方町・半島先端
    expect(byName.get('風早の郷風和里')?.pref).toBe('愛媛県'); // 松山市・都市近郊
    expect(byName.get('めじかの里土佐清水')?.pref).toBe('高知県'); // 土佐清水市・太平洋側
    expect(byName.get('ゆすはら')?.pref).toBe('高知県'); // 梼原町・山間部
  });

  it('新潟県「みかわ」と愛媛県「みかわ」は同音同名の別施設であり重複登録ではない', () => {
    const mikawa = STATIONS.filter((s) => s.name === 'みかわ');
    expect(mikawa).toHaveLength(2);
    expect(mikawa.map((s) => s.pref).sort()).toEqual(['新潟県', '愛媛県'].sort());
    const [a, b] = mikawa;
    expect(haversineKm(a, b)).toBeGreaterThan(400); // 別施設であることを距離でも確認
  });

  it('既存データ異常の修正: 宮城県「村田」の市区町村が郡名で切れていた不具合が直っている', () => {
    // 一次情報・国交省一覧とも所在地は「柴田郡村田町」。'柴田郡村' は途中で切れた誤値だった。
    const murata = STATIONS.find((s) => s.id === 'mne-18968');
    expect(murata?.city).toBe('村田町');
  });
});

describe('九州追加（販売版・全国展開Phase 8）', () => {
  const KYUSHU_PREFS = ['福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県'] as const;
  const kyushu = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '九州');
  const hokkaido = STATIONS.filter((s) => s.pref === '北海道');
  const tohoku = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '東北');
  const kanto = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '関東');
  const hokuriku = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '北陸');
  const chubu = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '中部');
  const kinki = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '近畿');
  const chugoku = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '中国');
  const shikoku = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '四国');

  it('北海道128・東北182・北陸105・中部178・近畿158・中国108・四国91・九州146の各地域件数は沖縄追加後も不変（関東は全国再突合で130→131）', () => {
    expect(hokkaido.length).toBe(128);
    expect(tohoku.length).toBe(182);
    expect(kanto.length).toBe(131); // 全国再突合(Phase 9)で「やどりきテラス清流の里」を追加
    expect(hokuriku.length).toBe(105);
    expect(chubu.length).toBe(178);
    expect(kinki.length).toBe(158);
    expect(chugoku.length).toBe(108);
    expect(shikoku.length).toBe(91);
    expect(kyushu.length).toBe(146);
  });

  it('九州は現在のproduct地方マスター定義どおり7県（沖縄は含まない）', () => {
    const prefsPresent = [...new Set(kyushu.map((s) => s.pref))].sort();
    expect(prefsPresent).toEqual([...KYUSHU_PREFS].sort());
    for (const p of KYUSHU_PREFS) expect(AREA_BY_PREFECTURE[p]).toBe('九州');
    // 沖縄はPhase 9で別地方として追加済み（九州には含めない）
    expect(AREA_BY_PREFECTURE['沖縄県']).toBe('沖縄');
  });

  it('県別内訳: 福岡17・佐賀11・長崎12・熊本38・大分26・宮崎19・鹿児島23（国交省一覧XLSの県別件数と一致）', () => {
    const counts: Record<string, number> = {};
    for (const s of kyushu) counts[s.pref] = (counts[s.pref] ?? 0) + 1;
    expect(counts).toEqual({
      福岡県: 17,
      佐賀県: 11,
      長崎県: 12,
      熊本県: 38,
      大分県: 26,
      宮崎県: 19,
      鹿児島県: 23,
    });
  });

  it('全駅で駅IDが衝突しない・座標が重複しない（九州追加後も9地域共存で成立）', () => {
    const ids = STATIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const seen = new Map<string, string>();
    for (const s of STATIONS) {
      const key = `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`;
      expect(seen.has(key), `${s.name} と ${seen.get(key)} が同一座標`).toBe(false);
      seen.set(key, s.name);
    }
  });

  it('九州の駅は全国化アダプタ(product/station)でも例外なく変換でき、地方(region)が正しく解決される', () => {
    for (const s of kyushu) {
      const n = toNationwideStation(s);
      expect(n.regionId, s.name).toBe('kyushu');
    }
  });

  it('九州facilitiesはPhase 10の全国監査で確定済み（値はyes/no/unknownのいずれか、undefinedではない）', () => {
    for (const s of kyushu) {
      expect(s.facilities, s.id).toBeDefined();
      expect(['yes', 'no', 'unknown'], s.id).toContain(s.facilities!.rvPark);
      expect(['yes', 'no', 'unknown'], s.id).toContain(s.facilities!.onsen);
    }
  });

  it('東北facility確定値(RV=4・温泉=21・BOTH=2)は九州追加後も不変', () => {
    expect(TOHOKU_STATIONS.filter((s) => s.facilities?.rvPark === 'yes')).toHaveLength(4);
    expect(TOHOKU_STATIONS.filter((s) => s.facilities?.onsen === 'yes')).toHaveLength(21);
    expect(TOHOKU_STATIONS.filter((s) => s.facilities?.rvPark === 'yes' && s.facilities?.onsen === 'yes')).toHaveLength(2);
  });

  it('熊本県は連絡会の検索一覧が落としていた最新2駅を含む38駅で、国交省一覧と一致する', () => {
    const kumamoto = kyushu.filter((s) => s.pref === '熊本県');
    expect(kumamoto).toHaveLength(38);
    const byId = new Map(kumamoto.map((s) => [s.id, s]));
    // 検索カード一覧(36件)には無く、同ページの地図データにのみ存在した2駅
    expect(byId.get('mne-22789')?.name).toBe('ウェルネスあらお'); // 第63回 R7.6 荒尾市
    expect(byId.get('mne-23223')?.name).toBe('くらたけ天草戦国ミュージアム'); // 第65回 R8.8 天草市
  });

  it('開業前の駅はstatus=pre_openで区別され、それ以外は全てopen', () => {
    const preOpen = kyushu.filter((s) => s.status === 'pre_open');
    expect(preOpen.map((s) => s.id)).toEqual(['mne-23223']); // 2026年11月22日オープン予定
    expect(preOpen[0]?.note).toBeTruthy();
    for (const s of kyushu) expect(['open', 'pre_open']).toContain(s.status);
    // 2026年6月5日オープン済みのウェルネスあらおはopen扱い
    expect(kyushu.find((s) => s.id === 'mne-22789')?.status).toBe('open');
  });

  it('一次情報のホームページ欄の異常（空リンク・先頭空白）を正規化している', () => {
    // 先頭に空白が入ったhrefはtrimして有効なURLにする
    const suzuta = kyushu.find((s) => s.id === 'mne-19858');
    expect(suzuta?.officialUrl).toBe('https://www.city.omura.nagasaki.jp/kankou/kanko/michinoeki/index.html');
    // 空リンクはnull（空文字にしない）。既存地域と同じ規約。
    for (const s of kyushu) {
      expect(s.officialUrl === null || /^https?:\/\/\S+$/.test(s.officialUrl!), s.id).toBe(true);
    }
    expect(kyushu.filter((s) => s.officialUrl === null).length).toBe(14);
  });

  it('九州は離島を含むが、全駅が九州の実在範囲に収まる', () => {
    for (const s of kyushu) {
      expect(s.lat, `${s.name} lat`).toBeGreaterThan(27.0);
      expect(s.lat, `${s.name} lat`).toBeLessThan(34.2);
      expect(s.lng, `${s.name} lng`).toBeGreaterThan(128.3);
      expect(s.lng, `${s.name} lng`).toBeLessThan(132.3);
    }
  });

  it('市区町村が全駅で市区町村名になっている（郡名や地域名が入っていない）', () => {
    for (const s of STATIONS) {
      const where = `${s.id} ${s.name} ${s.address}`;
      // 末尾が市区町村で終わる（「東信地域」「下高井郡」のような値を弾く）
      expect(s.city, where).toMatch(/[市区町村]$/);
      // 住所の都道府県の直後（郡があればその次）から、cityがそのまま続いている。
      // 「余市町」「四日市市」のように名称の途中に市/町/村を含む自治体があるため、
      // 正規表現で機械的に切り出すのではなく前方一致で突き合わせる。
      const rest = s.address.slice(s.pref.length);
      const afterGun = rest.replace(/^.{1,6}?郡/, '');
      expect(rest.startsWith(s.city) || afterGun.startsWith(s.city), where).toBe(true);
    }
  });

  it('既存データ異常の修正: cityに郡名・地域名が入っていた6件が直っている', () => {
    // いずれも連絡会の個別駅ページと国交省「道の駅」一覧の所在地で裏取り済み
    const byId = new Map(STATIONS.map((s) => [s.id, s]));
    expect(byId.get('mne-19186')?.city).toBe('上田市'); // 旧: 東信地域
    expect(byId.get('mne-19939')?.city).toBe('野沢温泉村'); // 旧: 下高井郡
    expect(byId.get('mne-22056')?.city).toBe('長和町'); // 旧: 小県郡
    expect(byId.get('mne-22371')?.city).toBe('佐久穂町'); // 旧: 南佐久郡
    expect(byId.get('mne-19956')?.city).toBe('設楽町'); // 旧: 北設楽郡
    expect(byId.get('mne-19957')?.city).toBe('矢掛町'); // 旧: 小田郡
    expect(byId.get('mne-18968')?.city).toBe('村田町'); // Phase 7で修正済み(旧: 柴田郡村)
  });

  it('7県の代表駅が正しく収録されている（都市近郊・山間部・海沿い・半島・離島・観光地）', () => {
    const byName = new Map(kyushu.map((s) => [s.name, s]));
    expect(byName.get('むなかた')?.pref).toBe('福岡県'); // 宗像市・海沿い(最北)
    expect(byName.get('かみみね')?.pref).toBe('佐賀県'); // 上峰町・都市近郊
    expect(byName.get('遣唐使ふるさと館')?.pref).toBe('長崎県'); // 五島市・離島(最西)
    expect(byName.get('阿蘇')?.pref).toBe('熊本県'); // 阿蘇市・山間部/観光地
    expect(byName.get('かまえ')?.pref).toBe('大分県'); // 佐伯市・海沿い(最東)
    expect(byName.get('青雲橋')?.pref).toBe('宮崎県'); // 日之影町・山間部
    expect(byName.get('とくのしま')?.pref).toBe('鹿児島県'); // 徳之島町・離島(最南)
  });
});

describe('沖縄追加と全国最新版突合（販売版・全国展開Phase 9）', () => {
  const okinawa = STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === '沖縄');
  const byArea = (a: string) => STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === a);

  it('全国10地域がそろい、合計1237施設で共存する', () => {
    expect(byArea('北海道')).toHaveLength(128);
    expect(byArea('東北')).toHaveLength(182);
    expect(byArea('関東')).toHaveLength(131); // 全国再突合で「やどりきテラス清流の里」を追加
    expect(byArea('北陸')).toHaveLength(105);
    expect(byArea('中部')).toHaveLength(178);
    expect(byArea('近畿')).toHaveLength(158);
    expect(byArea('中国')).toHaveLength(108);
    expect(byArea('四国')).toHaveLength(91);
    expect(byArea('九州')).toHaveLength(146);
    expect(okinawa).toHaveLength(10);
    expect(STATIONS).toHaveLength(1237);
  });

  it('AREASとPREFECTURESが全国47都道府県・10地方をカバーし、product地方マスターと一致する', () => {
    expect(AREAS).toHaveLength(10);
    expect(AREAS[AREAS.length - 1]).toBe('沖縄');
    expect(PREFECTURES).toHaveLength(47);
    // 全都道府県が地方に解決でき、地方マスター(product/region)と食い違わない
    for (const p of PREFECTURES) {
      const area = AREA_BY_PREFECTURE[p];
      expect(AREAS, p).toContain(area);
      const info = prefectureByName(p);
      expect(info, p).toBeDefined();
      expect(REGION_NAMES[info!.regionId], p).toBe(area);
    }
    // 収録データ側にも47都道府県すべてが存在する（未収録県ゼロ）
    const prefsInData = new Set(STATIONS.map((s) => s.pref));
    expect(prefsInData.size).toBe(47);
  });

  it('沖縄は1県のみで、収録10駅はすべて沖縄本島の範囲に収まる', () => {
    expect([...new Set(okinawa.map((s) => s.pref))]).toEqual(['沖縄県']);
    for (const s of okinawa) {
      expect(s.lat, s.name).toBeGreaterThan(26.0);
      expect(s.lat, s.name).toBeLessThan(26.9);
      expect(s.lng, s.name).toBeGreaterThan(127.5);
      expect(s.lng, s.name).toBeLessThan(128.4);
      expect(toNationwideStation(s).regionId).toBe('okinawa');
    }
  });

  it('沖縄facilitiesはPhase 10の全国監査で確定済み（値はyes/no/unknownのいずれか、undefinedではない）', () => {
    for (const s of okinawa) {
      expect(s.facilities, s.id).toBeDefined();
      expect(['yes', 'no', 'unknown'], s.id).toContain(s.facilities!.rvPark);
      expect(['yes', 'no', 'unknown'], s.id).toContain(s.facilities!.onsen);
    }
  });

  it('東北facility確定値(RV=4・温泉=21・BOTH=2)は沖縄追加・全国再突合後も不変', () => {
    expect(TOHOKU_STATIONS.filter((s) => s.facilities?.rvPark === 'yes')).toHaveLength(4);
    expect(TOHOKU_STATIONS.filter((s) => s.facilities?.onsen === 'yes')).toHaveLength(21);
    expect(TOHOKU_STATIONS.filter((s) => s.facilities?.rvPark === 'yes' && s.facilities?.onsen === 'yes')).toHaveLength(2);
  });

  it('全国再突合で追加した神奈川県「やどりきテラス清流の里」が正しく収録されている', () => {
    const yadoriki = STATIONS.find((s) => s.id === 'mne-23221');
    expect(yadoriki).toBeDefined();
    expect(yadoriki!.pref).toBe('神奈川県');
    expect(yadoriki!.city).toBe('松田町');
    expect(yadoriki!.address).toBe('神奈川県足柄上郡松田町寄3415');
    expect(yadoriki!.status).toBe('open'); // 令和8年5月17日リニューアルオープン済み
    expect(yadoriki!.note).toBeTruthy();
  });

  it('福島県「石川」は2026年9月18日の開業を公式サイトで確認して開業済みへ更新。station IDと座標は変わっていない', () => {
    const ishikawa = STATIONS.find((s) => s.id === 'mlit-r64-ishikawa');
    expect(ishikawa).toBeDefined(); // localStorage互換のためIDは変更しない
    expect(ishikawa!.status).toBe('open');
    expect(isRoutable(ishikawa!)).toBe(true);
    expect(ishikawa!.lat).toBeCloseTo(37.1664616, 6);
    expect(ishikawa!.lng).toBeCloseTo(140.4297082, 6);
    // 開業の根拠（道の駅石川公式サイト）を出典に持つ
    expect(ishikawa!.sources.some((u) => u.includes('michinoeki-isikawa.com'))).toBe(true);
    expect(ishikawa!.sources.some((u) => u.includes('michi-no-eki.jp/stations/views/22977'))).toBe(true);
  });

  it('開業前は開業日が未到来の1駅（くらたけ天草戦国ミュージアム・2026年11月22日予定）のみで、ルート候補から除外される', () => {
    const preOpen = STATIONS.filter((s) => s.status === 'pre_open');
    expect(preOpen.map((s) => s.id)).toEqual(['mne-23223']);
    for (const s of preOpen) expect(isRoutable(s)).toBe(false);
  });

  it('一次情報の住所欠落（自治体名の「村」欠落）を補正している', () => {
    const ginoza = STATIONS.find((s) => s.id === 'mne-19820');
    expect(ginoza!.address).toBe('沖縄県国頭郡宜野座村字漢那1633');
    expect(ginoza!.city).toBe('宜野座村');
  });

  it('URLに前後の空白が混入していない（福井「若狭熊川宿」で実際に発生していた）', () => {
    for (const s of STATIONS) {
      expect(s.infoUrl, s.id).toBe(s.infoUrl.trim());
      if (s.officialUrl) expect(s.officialUrl, s.id).toBe(s.officialUrl.trim());
    }
  });

  it('沖縄の代表駅が正しく収録されている（都市近郊・観光地・海沿い・やんばる）', () => {
    const byName = new Map(okinawa.map((s) => [s.name, s]));
    expect(byName.get('許田')?.city).toBe('名護市'); // 高速出口近く・観光拠点
    expect(byName.get('豊崎')?.city).toBe('豊見城市'); // 那覇近郊
    expect(byName.get('いとまん')?.city).toBe('糸満市'); // 海沿い・日本最南端級の市
    expect(byName.get('ゆいゆい国頭')?.city).toBe('国頭村'); // やんばる
    expect(byName.get('かでな')?.city).toBe('嘉手納町'); // 都市近郊
  });
});

describe('全国facility監査（販売版・全国横断Phase 10）', () => {
  const byArea = (a: string) => STATIONS.filter((s) => AREA_BY_PREFECTURE[s.pref] === a);
  const status = (f: 'rvPark' | 'onsen', v: string) => STATIONS.filter((s) => s.facilities?.[f] === v);

  it('全1237施設がfacility監査レコードを持ち、値はyes/no/unknownのいずれか', () => {
    expect(STATIONS).toHaveLength(1237);
    for (const s of STATIONS) {
      expect(s.facilities, `${s.id} ${s.name}`).toBeDefined();
      expect(['yes', 'no', 'unknown'], s.id).toContain(s.facilities!.rvPark);
      expect(['yes', 'no', 'unknown'], s.id).toContain(s.facilities!.onsen);
      // 監査日と根拠URLを必ず持つ（yes/noを根拠なしで埋めない）
      expect(s.facilities!.lastChecked, s.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('全国集計: RVパーク yes=30 / 温泉 yes=151 / 両方=10', () => {
    expect(status('rvPark', 'yes')).toHaveLength(30);
    expect(status('onsen', 'yes')).toHaveLength(151);
    expect(STATIONS.filter((s) => s.facilities?.rvPark === 'yes' && s.facilities?.onsen === 'yes')).toHaveLength(10);
  });

  it('unknownは温泉24件のみで、RVパークにunknownは残っていない', () => {
    expect(status('rvPark', 'unknown')).toHaveLength(0);
    expect(status('onsen', 'unknown')).toHaveLength(24);
    // unknownを含む駅はすべて、連絡会が施設情報自体を提供していない駅
    for (const s of status('onsen', 'unknown')) {
      expect(s.facilities!.onsen, s.id).toBe('unknown');
    }
  });

  it('unknownはno扱いにしない（施設フィルターの母集団に入らない）', () => {
    const unknowns = status('onsen', 'unknown');
    expect(unknowns.length).toBeGreaterThan(0);
    for (const s of unknowns) {
      expect(s.facilities!.onsen).not.toBe('no');
      expect(s.facilities!.onsen).not.toBe('yes');
    }
  });

  it('RVパークyesは道の駅の敷地内・一体運用のみ（隣接・近隣はno + relationで根拠を残す）', () => {
    for (const s of status('rvPark', 'yes')) {
      // yesの駅はrelationがintegratedか、未設定でも根拠URLを持つ
      if (s.facilities!.rvParkRelation) expect(['integrated', 'onsite'], s.id).toContain(s.facilities!.rvParkRelation);
      expect(s.facilities!.source, s.id).toMatch(/^https?:\/\//);
    }
    // 隣接・近隣として明示的にnoにした駅が存在し、false positiveになっていない
    const adjacent = STATIONS.filter((s) => s.facilities?.rvParkRelation === 'adjacent' || s.facilities?.rvParkRelation === 'nearby');
    expect(adjacent.length).toBeGreaterThan(0);
    for (const s of adjacent) expect(s.facilities!.rvPark, s.id).toBe('no');
  });

  it('地方別のfacility集計が全国合計と一致する', () => {
    const areas = ['北海道', '東北', '関東', '北陸', '中部', '近畿', '中国', '四国', '九州', '沖縄'];
    let rv = 0;
    let onsen = 0;
    for (const a of areas) {
      rv += byArea(a).filter((s) => s.facilities?.rvPark === 'yes').length;
      onsen += byArea(a).filter((s) => s.facilities?.onsen === 'yes').length;
    }
    expect(rv).toBe(status('rvPark', 'yes').length);
    expect(onsen).toBe(status('onsen', 'yes').length);
  });

  it('代表例: 全国監査で新たに確定したRVパーク併設駅', () => {
    const byId = new Map(STATIONS.map((s) => [s.id, s]));
    expect(byId.get('mne-19704')?.facilities?.rvPark).toBe('yes'); // むなかた(福岡)
    expect(byId.get('mne-19093')?.facilities?.rvPark).toBe('yes'); // たくみの里(群馬)
    expect(byId.get('mne-19590')?.facilities?.rvPark).toBe('yes'); // 阿武町(山口)
    expect(byId.get('mne-18815')?.facilities?.rvPark).toBe('yes'); // 阿寒丹頂の里(北海道)
  });

  it('代表例: 隣接するだけのRVパークはyesにしない', () => {
    const byId = new Map(STATIONS.map((s) => [s.id, s]));
    // 道の駅保田小学校: RVパークは「隣接する旧鋸南幼稚園」を再利用した別敷地
    expect(byId.get('mne-19827')?.facilities?.rvPark).toBe('no');
    expect(byId.get('mne-19827')?.facilities?.rvParkRelation).toBe('adjacent');
    // 道の駅さくらの里きすき: RVパークは「隣接する緑地公園内」
    expect(byId.get('mne-19545')?.facilities?.rvPark).toBe('no');
    expect(byId.get('mne-19545')?.facilities?.rvParkRelation).toBe('adjacent');
  });

  it('代表例: 温浴施設そのものを道の駅化した駅は温泉yes', () => {
    const konda = STATIONS.find((s) => s.id === 'mne-23222'); // こんだ温泉ぬくもりの郷(兵庫)
    expect(konda?.facilities?.onsen).toBe('yes');
  });

  it('沖縄は10施設すべてが監査済みで、RVパーク・温泉ともyesはない', () => {
    const okinawa = byArea('沖縄');
    expect(okinawa).toHaveLength(10);
    expect(okinawa.filter((s) => s.facilities?.rvPark === 'yes')).toHaveLength(0);
    expect(okinawa.filter((s) => s.facilities?.onsen === 'yes')).toHaveLength(0);
    for (const s of okinawa) expect(s.facilities, s.id).toBeDefined();
  });
});
