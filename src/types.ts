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

/** ユーザーの訪問状態 */
export type VisitStatus = 'none' | 'want' | 'visited';

export interface VisitRecord {
  status: VisitStatus;
  visitedAt: string | null;
  stamp: boolean;
  stampAt: string | null;
  updatedAt: string;
}

export type VisitMap = Record<string, VisitRecord>;

/** 地図の状態フィルター */
export type StatusFilter = 'all' | 'none' | 'want' | 'visited' | 'stamp';

/** ルート計画の入力条件 */
export interface PlanParams {
  origin: { lat: number; lng: number; label: string };
  /** 出発予定 (ISO文字列) */
  departAt: string;
  /** 使用可能時間（分）: 移動+滞在+帰路すべて込み */
  budgetMin: number;
  /** 1駅あたり滞在時間（分） */
  stayMin: number;
  returnToStart: boolean;
  useHighway: boolean;
  maxStops: number;
  /** 対象県（空=東北6県すべて） */
  prefs: Prefecture[];
  /** 県境を越えてよいか */
  crossPref: boolean;
  /** 対象駅: 未訪問のみ / 行きたい優先 / すべて */
  target: 'unvisited' | 'want_priority' | 'all';
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
  params: PlanParams;
  stops: RouteStop[];
  legs: RouteLeg[];
  totalMin: number;
  totalKm: number;
  /** 新しく制覇できる駅数（未訪問→訪問見込み） */
  newCount: number;
  returnAt: string;
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
