/** 道の駅の営業状態 */
export type StationStatus = 'open' | 'pre_open' | 'closed_temp' | 'unknown';

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
}

export const PREFECTURES = ['青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県'] as const;
export type Prefecture = (typeof PREFECTURES)[number];

export interface StationDataFile {
  meta: {
    verifiedAt: string;
    /** 国土交通省の登録駅数（東北6県） */
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
  /** 対象県（空=東北6県すべて） */
  prefs: Prefecture[];
  /** 県境を越えてよいか */
  crossPref: boolean;
  /** 優先条件: 未訪問優先 / 行きたい優先 / 近い順 */
  priority: PlanPriority;
  /** 訪問済みも候補に含める（初期OFF） */
  includeVisited: boolean;
  /** スタンプ済みも候補に含める（初期OFF） */
  includeStamped: boolean;
}

export interface RouteLeg {
  /** 出発地点 or 駅ID */
  fromId: string | null;
  toId: string | null;
  distanceKm: number;
  driveMin: number;
}

export interface RouteStop {
  stationId: string;
  arriveAt: string;
  departAt: string;
  stayMin: number;
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
  /** 'road'=実道路時間(OSRM) / 'approx'=概算 */
  roadData: 'road' | 'approx';
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
}
