/**
 * 全国化のための地方・都道府県マスターデータ。
 * JIS X 0401 都道府県コード（01〜47）に基づく。この表自体は事実に基づく静的データであり、
 * 全国道の駅データそのものを投入するものではない（Phase 1の対象外）。
 *
 * 既存の src/types.ts の Prefecture 型（東北6県専用のクローズドunion）とは独立しており、
 * 既存コードには一切影響しない。全国化時は Station 側を NationwideStation（station/配下）へ
 * 段階的に移行する。
 */

export const REGION_IDS = [
  'hokkaido',
  'tohoku',
  'kanto',
  'hokuriku',
  'chubu',
  'kinki',
  'chugoku',
  'shikoku',
  'kyushu',
  'okinawa',
] as const;
export type RegionId = (typeof REGION_IDS)[number];

export const REGION_NAMES: Record<RegionId, string> = {
  hokkaido: '北海道',
  tohoku: '東北',
  kanto: '関東',
  hokuriku: '北陸',
  chubu: '中部',
  kinki: '近畿',
  chugoku: '中国',
  shikoku: '四国',
  kyushu: '九州',
  okinawa: '沖縄',
};

export interface PrefectureInfo {
  /** JIS X 0401 都道府県コード ("01"〜"47") */
  code: string;
  name: string;
  regionId: RegionId;
}

/** 都道府県コード順（01〜47）。全国道の駅データの正規化・絞り込みの基盤となる。 */
export const PREFECTURE_TABLE: PrefectureInfo[] = [
  { code: '01', name: '北海道', regionId: 'hokkaido' },
  { code: '02', name: '青森県', regionId: 'tohoku' },
  { code: '03', name: '岩手県', regionId: 'tohoku' },
  { code: '04', name: '宮城県', regionId: 'tohoku' },
  { code: '05', name: '秋田県', regionId: 'tohoku' },
  { code: '06', name: '山形県', regionId: 'tohoku' },
  { code: '07', name: '福島県', regionId: 'tohoku' },
  { code: '08', name: '茨城県', regionId: 'kanto' },
  { code: '09', name: '栃木県', regionId: 'kanto' },
  { code: '10', name: '群馬県', regionId: 'kanto' },
  { code: '11', name: '埼玉県', regionId: 'kanto' },
  { code: '12', name: '千葉県', regionId: 'kanto' },
  { code: '13', name: '東京都', regionId: 'kanto' },
  { code: '14', name: '神奈川県', regionId: 'kanto' },
  { code: '15', name: '新潟県', regionId: 'hokuriku' },
  { code: '16', name: '富山県', regionId: 'hokuriku' },
  { code: '17', name: '石川県', regionId: 'hokuriku' },
  { code: '18', name: '福井県', regionId: 'hokuriku' },
  { code: '19', name: '山梨県', regionId: 'chubu' },
  { code: '20', name: '長野県', regionId: 'chubu' },
  { code: '21', name: '岐阜県', regionId: 'chubu' },
  { code: '22', name: '静岡県', regionId: 'chubu' },
  { code: '23', name: '愛知県', regionId: 'chubu' },
  { code: '24', name: '三重県', regionId: 'kinki' },
  { code: '25', name: '滋賀県', regionId: 'kinki' },
  { code: '26', name: '京都府', regionId: 'kinki' },
  { code: '27', name: '大阪府', regionId: 'kinki' },
  { code: '28', name: '兵庫県', regionId: 'kinki' },
  { code: '29', name: '奈良県', regionId: 'kinki' },
  { code: '30', name: '和歌山県', regionId: 'kinki' },
  { code: '31', name: '鳥取県', regionId: 'chugoku' },
  { code: '32', name: '島根県', regionId: 'chugoku' },
  { code: '33', name: '岡山県', regionId: 'chugoku' },
  { code: '34', name: '広島県', regionId: 'chugoku' },
  { code: '35', name: '山口県', regionId: 'chugoku' },
  { code: '36', name: '徳島県', regionId: 'shikoku' },
  { code: '37', name: '香川県', regionId: 'shikoku' },
  { code: '38', name: '愛媛県', regionId: 'shikoku' },
  { code: '39', name: '高知県', regionId: 'shikoku' },
  { code: '40', name: '福岡県', regionId: 'kyushu' },
  { code: '41', name: '佐賀県', regionId: 'kyushu' },
  { code: '42', name: '長崎県', regionId: 'kyushu' },
  { code: '43', name: '熊本県', regionId: 'kyushu' },
  { code: '44', name: '大分県', regionId: 'kyushu' },
  { code: '45', name: '宮崎県', regionId: 'kyushu' },
  { code: '46', name: '鹿児島県', regionId: 'kyushu' },
  { code: '47', name: '沖縄県', regionId: 'okinawa' },
];

const byName = new Map(PREFECTURE_TABLE.map((p) => [p.name, p]));
const byCode = new Map(PREFECTURE_TABLE.map((p) => [p.code, p]));

export function prefectureByName(name: string): PrefectureInfo | undefined {
  return byName.get(name);
}

export function prefectureByCode(code: string): PrefectureInfo | undefined {
  return byCode.get(code);
}

export function prefecturesInRegion(regionId: RegionId): PrefectureInfo[] {
  return PREFECTURE_TABLE.filter((p) => p.regionId === regionId);
}
