import type { Poi } from './lib/poi';

/** 道の駅の営業状態 */
export type StationStatus = 'open' | 'pre_open' | 'closed_temp' | 'unknown';

/**
 * 設備の有無。「情報が無い」を「無い」に丸めない（実データ監査で確認できなかった場合は
 * unknownのままにし、falseだと確定的に言い切らない）。
 */
export type FacilityStatus = 'yes' | 'no' | 'unknown';

/**
 * RVパーク候補と道の駅の位置関係。yes/no判定だけでは「隣接別施設」を誤って
 * 含めたり、逆に精査せず除外したりしやすいため、根拠を残すために分類する。
 * - onsite: 道の駅の駐車場・敷地内にある
 * - integrated: 道の駅の正式構成施設として運営・案内されている（onsiteを包含する強い分類）
 * - adjacent: 住所がほぼ同一だが、別法人が運営する隣接別施設
 * - nearby: 同一市町村内だが徒歩圏外（車で数分等）の別施設
 * - unrelated: 施設自体が道の駅と無関係（同名の別施設等）
 * ユーザー向け「RVパークあり」フィルター(rvPark='yes')に含めるのは
 * onsite/integratedのみ。adjacent/nearbyはrvPark='no'のまま、relationで根拠を残す。
 */
export type FacilityRelation = 'onsite' | 'integrated' | 'adjacent' | 'nearby' | 'unrelated';

/**
 * 道の駅そのものの施設属性（周辺スポット検索とは別。道の駅自体が持つ設備）。
 * 47都道府県への拡張時も同じ型・同じfilter engine（lib/ui.ts）で使う想定。
 * RVパーク: 日本RV協会(JRVA)公認の正式なRVパーク（道の駅の敷地内・併設のもの）。
 *   単なる広い駐車場や「車中泊できそう」は含まない。
 * 温泉: 道の駅施設内、または道の駅と一体運営・徒歩圏の併設温泉。数km離れた周辺温泉は含まない。
 */
export interface StationFacilities {
  rvPark: FacilityStatus;
  onsen: FacilityStatus;
  /** RVパーク候補が見つかった場合の位置関係（見つからなかった場合はundefined） */
  rvParkRelation?: FacilityRelation;
  /** 主な根拠URL */
  source?: string;
  /** 確認日 (YYYY-MM-DD) */
  lastChecked?: string;
}

/** 道の駅マスターデータ（1駅分） */
export interface Station {
  /** 永続ID（一度割り当てたら変更しない） */
  id: string;
  /** 正式名称（「道の駅」プレフィックスなし） */
  name: string;
  /** 読み（ひらがな）。確認できない場合は null */
  kana: string | null;
  /** 都道府県 */
  pref: Prefecture;
  /** 市区町村 */
  city: string;
  /** 住所（郵便番号を除く） */
  address: string;
  lat: number;
  lng: number;
  status: StationStatus;
  /** 道の駅・自治体などの公式ページURL */
  officialUrl: string | null;
  /** 全国「道の駅」連絡会 or 国土交通省の情報ページURL */
  infoUrl: string;
  /** データ確認日 (YYYY-MM-DD) */
  verifiedAt: string;
  /** 情報源URL一覧 */
  sources: string[];
  /** 補足（安達 上下線など） */
  note?: string;
  /** 道の駅自体の施設属性（RVパーク・温泉）。未収録の駅ではundefined（=unknown扱い） */
  facilities?: StationFacilities;
}

export const PREFECTURES = [
  '北海道',
  '青森県',
  '岩手県',
  '宮城県',
  '秋田県',
  '山形県',
  '福島県',
  '茨城県',
  '栃木県',
  '群馬県',
  '埼玉県',
  '千葉県',
  '東京都',
  '神奈川県',
  '新潟県',
  '富山県',
  '石川県',
  '福井県',
  '山梨県',
  '長野県',
  '岐阜県',
  '静岡県',
  '愛知県',
  '三重県',
  '滋賀県',
  '京都府',
  '大阪府',
  '兵庫県',
  '奈良県',
  '和歌山県',
  '鳥取県',
  '島根県',
  '岡山県',
  '広島県',
  '山口県',
  '徳島県',
  '香川県',
  '愛媛県',
  '高知県',
  '福岡県',
  '佐賀県',
  '長崎県',
  '熊本県',
  '大分県',
  '宮崎県',
  '鹿児島県',
  '沖縄県',
] as const;
export type Prefecture = (typeof PREFECTURES)[number];

/** 収録済みの地方（表示順）。今後の都道府県追加に合わせて増やす。 */
export const AREAS = ['北海道', '東北', '関東', '北陸', '中部', '近畿', '中国', '四国', '九州', '沖縄'] as const;
export type AreaName = (typeof AREAS)[number];

/** 都道府県が属する地方。product/region/regions.ts の地方区分マスターと整合させる。 */
export const AREA_BY_PREFECTURE: Record<Prefecture, AreaName> = {
  北海道: '北海道',
  青森県: '東北',
  岩手県: '東北',
  宮城県: '東北',
  秋田県: '東北',
  山形県: '東北',
  福島県: '東北',
  茨城県: '関東',
  栃木県: '関東',
  群馬県: '関東',
  埼玉県: '関東',
  千葉県: '関東',
  東京都: '関東',
  神奈川県: '関東',
  新潟県: '北陸',
  富山県: '北陸',
  石川県: '北陸',
  福井県: '北陸',
  山梨県: '中部',
  長野県: '中部',
  岐阜県: '中部',
  静岡県: '中部',
  愛知県: '中部',
  三重県: '近畿',
  滋賀県: '近畿',
  京都府: '近畿',
  大阪府: '近畿',
  兵庫県: '近畿',
  奈良県: '近畿',
  和歌山県: '近畿',
  鳥取県: '中国',
  島根県: '中国',
  岡山県: '中国',
  広島県: '中国',
  山口県: '中国',
  徳島県: '四国',
  香川県: '四国',
  愛媛県: '四国',
  高知県: '四国',
  福岡県: '九州',
  佐賀県: '九州',
  長崎県: '九州',
  熊本県: '九州',
  大分県: '九州',
  宮崎県: '九州',
  鹿児島県: '九州',
  沖縄県: '沖縄',
};

export interface StationDataFile {
  meta: {
    verifiedAt: string;
    /** 国土交通省の登録駅数（収録都道府県の合計） */
    registrationCount: number;
    /** 収録施設数（安達 上下線を2施設と数える） */
    facilityCount: number;
    countsByPref: Record<string, number>;
    sources: { name: string; url: string }[];
    notes: string[];
  };
  stations: Station[];
}

/**
 * ユーザーが付ける駅の状態（相互排他の主要状態）。
 * タップするたびに unvisited → visited → wishlist → stamped → unvisited と1段階ずつ循環する。
 * 開業前(upcoming)は駅マスターデータ(status)由来で、ユーザー操作では変更できない。
 */
export type StationState = 'unvisited' | 'visited' | 'wishlist' | 'stamped';

export interface VisitRecord {
  state: StationState;
  /** 訪問済み/スタンプ取得済みになった日時 */
  visitedAt: string | null;
  /** 行きたいになった日時 */
  wishlistAt: string | null;
  /** スタンプ取得済みになった日時 */
  stampAt: string | null;
  updatedAt: string;
}

export type VisitMap = Record<string, VisitRecord>;

/** 地図の状態フィルター */
export type StatusFilter = 'all' | 'none' | 'want' | 'visited' | 'stamp';

/** 道路条件（OSRM側で厳密反映できないものはGoogleマップURLへ渡す） */
export type RoadPref = 'highway_ok' | 'no_highway' | 'no_tolls';

/** 優先条件 */
export type PlanPriority = 'unvisited' | 'wishlist' | 'nearest';

/** ルート計画の入力条件 */
export interface PlanParams {
  origin: { lat: number; lng: number; label: string };
  /** 出発予定 (ISO文字列) */
  departAt: string;
  /** お出かけ時間（分）: 移動+滞在+帰路+安全余裕すべて込み */
  budgetMin: number;
  /** 1駅あたり滞在時間（分） */
  stayMin: number;
  returnToStart: boolean;
  roadPref: RoadPref;
  maxStops: number;
  /** 対象県（空=収録都道府県すべて） */
  prefs: Prefecture[];
  /** 県境を越えてよいか */
  crossPref: boolean;
  /** 優先条件: 未訪問優先 / 行きたい優先 / 近い順 */
  priority: PlanPriority;
  /** 訪問済みも候補に含める（初期OFF） */
  includeVisited: boolean;
  /** スタンプ済みも候補に含める（初期OFF） */
  includeStamped: boolean;
  /** 営業時間内に到着できる駅を優先（初期ON。時間外予想は優先度を下げるが完全除外はしない） */
  preferOpenHours: boolean;
  /** 営業時間外予想の駅も候補に含める（初期ON。OFFで除外） */
  includeClosedHours: boolean;
  /** 営業時間不明（要確認）の駅も候補に含める（初期ON。OFFで除外） */
  includeUnknownHours: boolean;
}

export interface RouteLeg {
  /** 出発地点 or 駅ID */
  fromId: string | null;
  toId: string | null;
  distanceKm: number;
  driveMin: number;
  /**
   * trueなら、この区間はOSRM(実道路)が正常応答した上で「到達不能」と判定した区間
   * （水路・通行不可等）で、distanceKm/driveMinは概算モデルによる代替値。
   * 通信障害による概算とは異なり、実道路データ上そもそも自動車で接続できない
   * 可能性がある区間であることをUIで明示するためのフラグ。省略時はfalse相当
   * （既存の保存ルートとの後方互換）。
   */
  unreachable?: boolean;
}

/** 混合ルートの立ち寄り先の内部種別（道の駅と同列で扱うための共通分類） */
export type StopType = 'station' | 'restaurant' | 'cafe' | 'onsen' | 'tourism' | 'lodging' | 'park' | 'other';

export interface RouteStop {
  /** 道の駅の場合は実際の駅ID。周辺スポットの場合はPoi.idをそのまま使う（一意性のため） */
  stationId: string;
  arriveAt: string;
  departAt: string;
  stayMin: number;
  /**
   * 立ち寄り先の種別。省略時（既存の保存データ）は道の駅として扱う後方互換のため。
   * 'station'以外は周辺スポット（Poi）で、達成率・スタンプ数には一切影響しない。
   */
  stopType?: StopType;
  /** stopTypeが道の駅以外のときの周辺スポット詳細 */
  poi?: Poi;
}

export interface PlannedRoute {
  key: string;
  title: string;
  /** なぜこの提案になったかの短い説明 */
  reason: string;
  params: PlanParams;
  stops: RouteStop[];
  legs: RouteLeg[];
  /** 移動+滞在の合計（分）。安全余裕は含まない */
  totalMin: number;
  /** 総移動時間（分） */
  driveMin: number;
  /** 総滞在時間（分） */
  stayTotalMin: number;
  /** 安全余裕（分）。totalMin + marginMin <= budgetMin を保証 */
  marginMin: number;
  totalKm: number;
  /** 新しく制覇できる駅数（未訪問→訪問見込み） */
  newCount: number;
  /** 行きたい(wishlist)の駅数 */
  wantCount: number;
  returnAt: string;
  /** 'road'=実道路時間(OSRM) / 'approx'=概算（OSRM通信自体が失敗した場合） */
  roadData: 'road' | 'approx';
  /**
   * trueなら、roadData==='road'でも一部区間がOSRM上「到達不能」と判定され
   * 概算値で補完している（legs[].unreachableで該当区間を特定できる）。
   * UIは「実道路時間を使用」を無条件で表示せず、この区間の存在を明示すること。
   * 省略時はfalse相当（既存の保存ルートとの後方互換）。
   */
  hasUnreachableLeg?: boolean;
  /** 到着予定時刻で見た営業見込みの内訳 */
  hoursSummary: { open: number; closing: number; closed: number; unknown: number };
}

/** 保存済みルート */
export interface SavedRoute {
  id: string;
  name: string;
  createdAt: string;
  route: PlannedRoute;
  done: boolean;
}

/** 旅行中の進行状態 */
export type StopProgress = 'pending' | 'arrived' | 'done' | 'skipped';

export interface TripState {
  savedRouteId: string;
  startedAt: string;
  progress: Record<string, StopProgress>;
  /** 旅行中に変更した道路の希望（未変更ならコース作成時の設定をそのまま使う） */
  roadPref?: RoadPref;
}
