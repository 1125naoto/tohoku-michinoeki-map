/**
 * 周辺スポット取得の抽象化（PoiProvider）。
 *
 * 目的: UI（PoiSearchPanel等）やApp.tsxの検索フローが「データがどこから来たか
 * （事前生成の静的JSON／ライブOverpass／将来の有料Places API）」を意識しなくて
 * よいようにする。販売版でOSMのカバレッジが不十分と判明した場合に、UIを一切
 * 変更せず ExternalPlacesProvider を差し込めることを目標にした設計。
 *
 * 今回のスコープでは実装しない/確定しないこと:
 * - 有料Places APIとの契約・料金プラン
 * - APIキーの要求・設定UI
 * - ExternalPlacesProviderの実装そのもの（クラスの型だけ用意し、呼び出せば
 *   明示的にエラーになるプレースホルダーに留める）
 */
import type { EndpointAttemptLog, SearchRadiusM } from './overpass';
import { searchNearbyPoisAuto } from './overpass';
import { loadStaticPoiCache } from './poiStaticCache';
import type { Poi } from './poi';

export interface PoiOrigin {
  lat: number;
  lng: number;
}

export interface PoiProviderResult {
  pois: Poi[];
  /** trueなら、このproviderではデータを提供できなかった（呼び出し側は次のproviderへ進んでよい） */
  failed: boolean;
  /** 事前生成データ/前回結果など、今回新規に取得したデータではない場合true */
  fromCache: boolean;
  radiusUsed: SearchRadiusM;
  /** 接続先ごとの試行ログ（診断表示専用。無い場合は空配列） */
  attemptLog: EndpointAttemptLog[];
  /** trueなら食べる(food)系カテゴリの結果が欠けている可能性がある（failed:falseでも立ちうる） */
  foodIncomplete: boolean;
  /** trueなら温泉・観光等(other)系カテゴリの結果が欠けている可能性がある */
  otherIncomplete: boolean;
}

export interface PoiProvider {
  readonly name: 'static-osm' | 'overpass-live' | 'external-places';
  search(origin: PoiOrigin, radius: SearchRadiusM, signal?: AbortSignal): Promise<PoiProviderResult>;
}

/**
 * 道の駅ごとに事前生成された静的POIキャッシュ（public/data/poi/<stationId>.json）。
 * 道の駅起点の検索専用（現在地検索では使わない。B6: 現在地検索は必ず
 * OverpassPoiProviderでその場のlat/lngを中心に検索する）。
 */
export class StaticOsmPoiProvider implements PoiProvider {
  readonly name = 'static-osm' as const;
  constructor(private readonly stationId: string) {}

  async search(_origin: PoiOrigin, radius: SearchRadiusM, signal?: AbortSignal): Promise<PoiProviderResult> {
    const cache = await loadStaticPoiCache(this.stationId, signal);
    if (!cache || cache.pois.length === 0) {
      return {
        pois: [],
        failed: true,
        fromCache: false,
        radiusUsed: radius,
        attemptLog: [],
        foodIncomplete: false,
        otherIncomplete: false,
      };
    }
    // Astra監査P1（static/liveの検索範囲不一致）: 静的キャッシュは常に
    // cache.radiusM（国内一律10km）で生成されているため、要求範囲(radius)が
    // それより狭い場合はそのまま全件を返さず、要求範囲内に絞り込んでから返す
    // （そうしないと「3km検索」のつもりで最大10km先のPOIまで表示されてしまい、
    // 表示中の検索範囲の意味とズレる。かつ、常に10km分が返るため3km圏に
    // 本当は候補が少ない場合でも自動拡張[3→5→10km]が正しく働かなくなる）。
    // 逆に要求範囲がキャッシュの生成範囲を超える場合（15km等）は、このキャッシュ
    // だけでは応えられないため failed:true とし、呼び出し側をライブ検索へ回す。
    if (radius > cache.radiusM) {
      return {
        pois: [],
        failed: true,
        fromCache: false,
        radiusUsed: radius,
        attemptLog: [],
        foodIncomplete: false,
        otherIncomplete: false,
      };
    }
    const filtered = radius === cache.radiusM ? cache.pois : cache.pois.filter((p) => p.distanceM <= radius);
    // fetch_poi_cache.pyはAstra監査P1対応でfood/other個別の成否を
    // foodIncomplete/otherIncompleteとしてJSONへ記録するようになった（追加フィールド）。
    // 旧生成ファイル（フィールド自体が無い）は「両方成功」相当としてfalseを返す
    // （後方互換。生成当時は部分成功が"ok"として保存されていたため、これ以上は判定できない）。
    return {
      pois: filtered,
      failed: false,
      fromCache: true,
      radiusUsed: radius,
      attemptLog: [],
      foodIncomplete: cache.foodIncomplete ?? false,
      otherIncomplete: cache.otherIncomplete ?? false,
    };
  }
}

/** ライブOverpass検索（現在地検索・静的キャッシュ未生成時のフォールバックの両方で使う） */
export class OverpassPoiProvider implements PoiProvider {
  readonly name = 'overpass-live' as const;

  async search(origin: PoiOrigin, radius: SearchRadiusM, signal?: AbortSignal): Promise<PoiProviderResult> {
    const res = await searchNearbyPoisAuto(origin.lat, origin.lng, radius, signal);
    return {
      pois: res.pois,
      failed: res.failed,
      fromCache: res.fromCache,
      radiusUsed: res.radiusUsed,
      attemptLog: res.attemptLog,
      foodIncomplete: res.foodIncomplete,
      otherIncomplete: res.otherIncomplete,
    };
  }
}

/**
 * 将来、販売版Phase 2で商用Places API（Google Places / HERE / Foursquare等）を
 * 採用する場合のための型のみのプレースホルダー。今回の監査でOSM単独では
 * 実用精度が不足すると判断された場合の受け皿として用意するが、
 * 今回のスコープではAPIキーの要求・契約内容の確定・実装は一切行わない。
 * 誤って呼び出された場合は明示的に例外を投げ、無言でOSM相当の空結果に
 * フォールバックしない（設定漏れに気付けるように）。
 */
export class ExternalPlacesProvider implements PoiProvider {
  readonly name = 'external-places' as const;

  search(): Promise<PoiProviderResult> {
    throw new Error(
      'ExternalPlacesProvider is not implemented yet (Phase 2 candidate). ' +
        'See docs/PRODUCT_HANDOFF_PLAN.md for the provider comparison to make before implementing this.',
    );
  }
}
