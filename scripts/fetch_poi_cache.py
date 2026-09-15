"""
道の駅周辺スポット(POI)の事前取得キャッシュ生成スクリプト（全国版）。

目的: ユーザーのスマホが毎回Overpass公開APIへ直接依存する構造をやめ、
各道の駅の周辺スポットを事前に取得して public/data/poi/<stationId>.json
として静的配信する。アプリ側はこの静的JSONをまず読み、必要なら裏で
Overpassへ再検証をかける（stale-while-revalidateと同じ考え方を
「初回訪問者にも効かせる」ために事前生成する）。

本番コード(src/lib/overpass.ts, src/lib/poi.ts)のクエリ・分類・正規化・
重複除去ロジックと同一内容をPythonで再現している（ロジックの二重管理を
避けるため、両者を変更する場合は必ず両方に反映すること）。
地方/都道府県マスターも src/product/region/regions.ts と同一内容を
PREFECTURE_TABLE として複製している（同上の理由）。

Phase 11（全国POI static cache生成）での変更点:
  - 飲食(food)とそれ以外(other)のクエリを分離（overpass.tsのライブ検索と同じ
    理由: 都市部の道の駅では単一クエリ・共有上限だとラーメン等の実在店舗が
    そもそも応答に含まれないことがある。Tohoku生成時は道の駅が郊外中心で
    問題が出ていなかったが、全国展開で都市近郊の道の駅が増えるため揃える）。
  - 接続先の切り替えは速さを優先し、各接続先は1回だけ試して即座に次へ切り替える。
    3接続先すべてが1周して全滅した場合のみ、指数バックオフを挟んでもう1周だけ
    再試行する（1駅あたりの所要時間を膨らませずに「一時的な全滅」を救うため）。
  - 実行のたびに全駅ゼロからやり直すのではなく、チェックポイント
    (data/poi_cache_checkpoint.json) に駅ごとの成功/失敗・接続先統計を記録し、
    中断後の再実行や「失敗した駅だけ再試行」を可能にする。
  - 既存キャッシュが十分新しければ（既定60日以内）再取得しない
    （--force / --stale-days で変更可能）。
  - 地方(--regions)・都道府県(--prefectures)単位での絞り込みに対応
    （GitHub Actionsのmatrix分割や手動の地域単位実行のため）。
  - 通信が本当に失敗した場合はチェックポイントに failed として記録するのみで
    キャッシュファイルは書かない（＝0件の空配列を誤って「正常な0件」として
    保存しない）。正常応答で本当に0件だった場合のみ pois:[] のファイルを書き、
    schemaに "status": "ok" を付与する。

実行方法:
  py -3 scripts/fetch_poi_cache.py                       # 対象(既定: open全駅)のうち未生成/期限切れのみ
  py -3 scripts/fetch_poi_cache.py mne-19013 mne-18990    # 指定駅のみ(PoC等)
  py -3 scripts/fetch_poi_cache.py --only-missing         # 未生成の駅だけ（新鮮でも既存があればスキップ）
  py -3 scripts/fetch_poi_cache.py --retry-failed         # 前回チェックポイントで失敗した駅だけ再試行
  py -3 scripts/fetch_poi_cache.py --regions tohoku,kanto # 地方単位
  py -3 scripts/fetch_poi_cache.py --prefectures 青森県,岩手県
  py -3 scripts/fetch_poi_cache.py --force                # 新鮮でも全部作り直す
  py -3 scripts/fetch_poi_cache.py --max-stations 300     # 1回の実行での上限件数（週次ジョブの時間制約用）
  py -3 scripts/fetch_poi_cache.py --stats                # 通信せずチェックポイントの集計だけ表示

出力: public/data/poi/<stationId>.json
  {
    "stationId", "lat", "lng", "radiusM", "generatedAt",
    "schemaVersion", "source", "queryVersion", "status", "pois": [...]
  }
  既存フィールド(stationId/lat/lng/radiusM/generatedAt/pois)は変更しない。
  追加フィールドは後方互換（アプリ側は無視しても動作する）。

公開APIへの配慮として、駅ごとのリクエスト間に REQUEST_INTERVAL_S 秒のスリープを入れる。
"""
import argparse
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

# Windowsのコンソール(既定cp932)は道の駅名に含まれる一部の記号(♡等)を表示できず、
# print()がUnicodeEncodeErrorで例外を投げて数時間がかりのバッチ処理全体が
# 落ちる実例があった。標準出力をUTF-8化し、それでも表示できない文字は
# 例外にせず置換するだけにする（1駅の表示都合で全体を壊さない）。
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")
from concurrent.futures import TimeoutError as FuturesTimeoutError
from pathlib import Path
from threading import Lock

ROOT = Path(__file__).resolve().parent.parent
STATIONS_JSON = ROOT / "src" / "data" / "stations.json"
OUT_DIR = ROOT / "public" / "data" / "poi"
CHECKPOINT_PATH = ROOT / "data" / "poi_cache_checkpoint.json"

# --- 本番コード(src/lib/overpass.ts)と同一の接続先・設定 ---------------------
ENDPOINTS = [
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]
RADIUS_M = 10000  # 事前生成はAUTO_ESCALATE_MAX_Mと同じ上限で最初から広めに取得する
POI_RESULT_LIMIT = 30
# src/lib/overpass.ts の FOOD_ELEMENT_LIMIT / OVERPASS_ELEMENT_LIMIT と同一値
FOOD_ELEMENT_LIMIT = 100
OTHER_ELEMENT_LIMIT = 80
POI_SCHEMA_VERSION = 3  # src/lib/poi.ts の POI_SCHEMA_VERSION と同一値
QUERY_VERSION = 2  # このスクリプトのクエリ構造の版（v1=単一クエリ、v2=food/other分離）
REQUEST_HEADERS = {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": "tohoku-michinoeki-map/1.0 (+https://github.com/1125naoto/tohoku-michinoeki-map; "
    "contact: poi-cache-generator)",
    "Referer": "https://1125naoto.github.io/tohoku-michinoeki-map/",
    "Accept": "*/*",
}
REQUEST_TIMEOUT_S = 15  # 接続先1つあたりの上限。低いほど不調な接続先から速く見切りを付けられる
REQUEST_INTERVAL_S = 1.5  # 駅ごとの間隔（公開APIへの配慮）
STAGGER_S = 0.6  # src/lib/overpass.ts の STAGGER_MS(600ms)と同一値
MAX_ROUND_RETRIES = 1  # 全接続先が1周して全滅した場合のみ、もう1周だけ試す（駅ごとの上限は変えない）
BACKOFF_BASE_S = 4.0  # ラウンド間の指数バックオフ（1周目失敗後: 4秒待って2周目）
DEFAULT_STALE_DAYS = 60  # 既存キャッシュをこの日数以内なら「新鮮」として再取得しない

# --- 地方/都道府県マスター（src/product/region/regions.ts と同一内容） -------
REGION_NAMES = {
    "hokkaido": "北海道", "tohoku": "東北", "kanto": "関東", "hokuriku": "北陸",
    "chubu": "中部", "kinki": "近畿", "chugoku": "中国", "shikoku": "四国",
    "kyushu": "九州", "okinawa": "沖縄",
}
PREFECTURE_TO_REGION = {
    "北海道": "hokkaido",
    "青森県": "tohoku", "岩手県": "tohoku", "宮城県": "tohoku", "秋田県": "tohoku", "山形県": "tohoku", "福島県": "tohoku",
    "茨城県": "kanto", "栃木県": "kanto", "群馬県": "kanto", "埼玉県": "kanto", "千葉県": "kanto", "東京都": "kanto", "神奈川県": "kanto",
    "新潟県": "hokuriku", "富山県": "hokuriku", "石川県": "hokuriku", "福井県": "hokuriku",
    "山梨県": "chubu", "長野県": "chubu", "岐阜県": "chubu", "静岡県": "chubu", "愛知県": "chubu",
    "三重県": "kinki", "滋賀県": "kinki", "京都府": "kinki", "大阪府": "kinki", "兵庫県": "kinki", "奈良県": "kinki", "和歌山県": "kinki",
    "鳥取県": "chugoku", "島根県": "chugoku", "岡山県": "chugoku", "広島県": "chugoku", "山口県": "chugoku",
    "徳島県": "shikoku", "香川県": "shikoku", "愛媛県": "shikoku", "高知県": "shikoku",
    "福岡県": "kyushu", "佐賀県": "kyushu", "長崎県": "kyushu", "熊本県": "kyushu", "大分県": "kyushu", "宮崎県": "kyushu", "鹿児島県": "kyushu",
    "沖縄県": "okinawa",
}


def region_of(pref):
    return PREFECTURE_TO_REGION.get(pref, "unknown")


def build_food_query(lat, lng, radius_m):
    """src/lib/overpass.ts の buildFoodQuery() と同一内容。"""
    around = f"(around:{radius_m},{lat},{lng})"
    return (
        "[out:json][timeout:12];"
        f'nwr["amenity"~"^(restaurant|cafe|fast_food|bar|pub)$"]{around};'
        f"out center body {FOOD_ELEMENT_LIMIT};"
    )


def build_other_query(lat, lng, radius_m):
    """src/lib/overpass.ts の buildOtherQuery() と同一内容。"""
    around = f"(around:{radius_m},{lat},{lng})"
    return (
        "[out:json][timeout:12];"
        "("
        f'nwr["amenity"~"^(public_bath|foot_bath|shelter|place_of_worship)$"]{around};'
        f'nwr["tourism"~"^(attraction|viewpoint|museum|zoo|aquarium|camp_site|artwork|gallery|picnic_site|hotel|guest_house|hostel|motel)$"]{around};'
        f'nwr["leisure"~"^(park|spa)$"]{around};'
        f'nwr["natural"~"^(hot_spring|beach|waterfall|peak|cliff)$"]{around};'
        f'nwr["shop"~"^(confectionery|pastry)$"]{around};'
        f'nwr["highway"="rest_area"]{around};'
        ");"
        f"out center body {OTHER_ELEMENT_LIMIT};"
    )


# 実データ監査(仙台/盛岡/山形、restaurant/fast_food計718件)で確認した、
# ラーメン以外に使われない語のみを追加。cuisine=noodleそのものや「麺」単独は
# そば/うどん/麻辣湯/パスタ店にも付与されているため使わない
# (例: 「洋麺屋五右衛門」はパスタ店、「丸亀製麺」はうどん店、
#  「そばの神田」「生そば 福はら」はそば店、「七宝麻辣湯」は麻辣湯店)。
RAMEN_NAME_RE = re.compile(
    "ラーメン|らーめん|らぁめん|らあめん|拉麺|中華そば|中華蕎麦|支那そば"
    "|つけ麺|油そば|^麺屋|^麺処|^麺房|^麺工房|ramen",
    re.IGNORECASE,
)
# 全国チェーンで店名・cuisineタグにラーメンを示す語が現れないことを実データで
# 確認した店。チェーン名が一意なため誤分類リスクが無い。
RAMEN_CHAIN_RE = re.compile("一蘭|町田商店")
SUSHI_NAME_RE = re.compile("寿司|すし|鮨")
YAKINIKU_NAME_RE = re.compile("焼肉|焼き肉")
# 実データ監査（全国1235駅cache・food_other 26,476件の店名分布、2026-09-15）:
# cuisine=westernはほぼ使われておらず（福島市街地10km圏の実測133件中0件）、
# 一方で店名に以下の語を含む店がfood_otherに埋もれていた
# （洋食系276件・居酒屋601件・食堂1189件・ピザ/パスタ系118件）。
# 「レストラン」単体は洋食以外にも広く使われるため意図的に含めない。
YOSHOKU_NAME_RE = re.compile("洋食|ステーキ|ハンバーグ|グリル|ビストロ|フレンチ")
ITALIAN_NAME_RE = re.compile("ピザ|パスタ|イタリアン|pizza", re.IGNORECASE)
IZAKAYA_NAME_RE = re.compile("居酒屋")
SHOKUDO_NAME_RE = re.compile("食堂")


def classify_food_genre(cuisine, name):
    """src/lib/poi.ts の classifyFoodGenre() と同一ロジック。
    cuisineタグを最優先し、無い/一致しない場合のみ高精度な店名キーワードで補う
    （日本のOSMは飲食店にcuisineタグが付いていないことが非常に多いため）。
    """
    if "ramen" in cuisine:
        return "ramen"
    if "sushi" in cuisine:
        return "sushi"
    if "yakiniku" in cuisine or "korean" in cuisine:
        return "yakiniku"
    if "italian" in cuisine:
        return "italian"
    if "izakaya" in cuisine:
        return "izakaya"
    if "western" in cuisine:
        return "yoshoku"
    if "japanese" in cuisine:
        return "shokudo"
    if "dessert" in cuisine or "cake" in cuisine:
        return "sweets"
    if RAMEN_NAME_RE.search(name):
        return "ramen"
    if RAMEN_CHAIN_RE.search(name):
        return "ramen"
    if SUSHI_NAME_RE.search(name):
        return "sushi"
    if YAKINIKU_NAME_RE.search(name):
        return "yakiniku"
    # 居酒屋・食堂は店名にジャンルがそのまま入っていることが非常に多い。
    # yakiniku/sushi/ramen判定を先に行うため「焼肉食堂」等は焼肉が優先される。
    if IZAKAYA_NAME_RE.search(name):
        return "izakaya"
    if SHOKUDO_NAME_RE.search(name):
        return "shokudo"
    if YOSHOKU_NAME_RE.search(name):
        return "yoshoku"
    if ITALIAN_NAME_RE.search(name):
        return "italian"
    return None


def is_onsen_facility(tags, name):
    """src/lib/poi.ts の isOnsenFacility() と同一ロジック。"""
    return tags.get("bath:type") == "onsen" or "温泉" in name


def classify(tags):
    """src/lib/poi.ts の classify() と同一ロジック。
    戻り値は (category, subcategory, subcategories) の3要素タプル。
    """
    amenity = tags.get("amenity")
    tourism = tags.get("tourism")
    leisure = tags.get("leisure")
    natural = tags.get("natural")
    shop = tags.get("shop")
    highway = tags.get("highway")
    cuisine = (tags.get("cuisine") or "").lower()
    religion = tags.get("religion")
    name = tags.get("name:ja") or tags.get("name") or ""

    def single(category, subcategory):
        return (category, subcategory, [subcategory])

    if natural == "hot_spring":
        return single("onsen", "onsen")
    if amenity == "public_bath":
        if is_onsen_facility(tags, name):
            return ("onsen", "higaeri_onsen", ["higaeri_onsen", "onsen"])
        return single("onsen", "higaeri_onsen")
    if leisure == "spa":
        if is_onsen_facility(tags, name):
            return ("onsen", "onyoku_shisetsu", ["onyoku_shisetsu", "onsen"])
        return single("onsen", "onyoku_shisetsu")
    if amenity == "foot_bath":
        return single("onsen", "ashiyu")
    if highway == "rest_area" or tourism == "picnic_site" or amenity == "shelter":
        return single("onsen", "kyukei")

    if amenity == "cafe":
        return single("food", "cafe")
    if shop in ("confectionery", "pastry"):
        return single("food", "sweets")
    if amenity in ("fast_food", "restaurant", "bar", "pub"):
        genre = classify_food_genre(cuisine, name)
        if genre:
            return single("food", genre)
        return single("food", "fastfood" if amenity == "fast_food" else "food_other")

    if amenity == "place_of_worship" and religion in ("shinto", "buddhist"):
        return single("tourism", "jinja_tera")
    if leisure == "park":
        return single("tourism", "koen")
    if tourism == "museum":
        return single("tourism", "hakubutsukan")
    if tourism == "viewpoint":
        return single("tourism", "tenbo")
    if tourism in ("zoo", "aquarium"):
        return single("tourism", "doubutsuen_suizokukan")
    if tourism == "camp_site":
        return single("tourism", "camp")
    if natural in ("beach", "waterfall", "peak", "cliff"):
        return single("tourism", "keishou")
    if tourism == "attraction":
        return single("tourism", "meisho")
    if tourism in ("artwork", "gallery"):
        return single("tourism", "tourism_other")

    if tourism in ("hotel", "motel"):
        return single("lodging", "hotel")
    if tourism == "guest_house":
        return single("lodging", "guesthouse")
    if tourism == "hostel":
        return single("lodging", "hostel")

    return None


def build_address(tags):
    """src/lib/poi.ts の buildAddress() と同一内容。"""
    pref = tags.get("addr:province") or tags.get("addr:state")
    city = tags.get("addr:city") or tags.get("addr:town") or tags.get("addr:village")
    suburb = tags.get("addr:suburb")
    street = tags.get("addr:street")
    house_number = tags.get("addr:housenumber")
    parts = [p for p in (pref, city, suburb, street, house_number) if p]
    return "".join(parts) if parts else None


def haversine_m(lat1, lng1, lat2, lng2):
    r = 6371008.8
    to_rad = math.radians
    d_lat = to_rad(lat2 - lat1)
    d_lng = to_rad(lng2 - lng1)
    a = math.sin(d_lat / 2) ** 2 + math.cos(to_rad(lat1)) * math.cos(to_rad(lat2)) * math.sin(d_lng / 2) ** 2
    return 2 * r * math.asin(min(1, math.sqrt(a)))


def normalize_element(el, origin_lat, origin_lng):
    """src/lib/poi.ts の normalizeOsmElement() と同一内容。"""
    tags = el.get("tags", {})
    cls = classify(tags)
    if not cls:
        return None
    category, subcategory, subcategories = cls
    lat = el.get("lat")
    lng = el.get("lon")
    if lat is None or lng is None:
        center = el.get("center") or {}
        lat = center.get("lat")
        lng = center.get("lon")
    if lat is None or lng is None:
        return None
    type_key = el.get("type", "node")
    return {
        "id": f"osm:{type_key}/{el['id']}",
        "category": category,
        "subcategory": subcategory,
        "subcategories": subcategories,
        "name": tags.get("name:ja") or tags.get("name"),
        "lat": lat,
        "lng": lng,
        "address": build_address(tags),
        "openingHoursRaw": tags.get("opening_hours"),
        "phone": tags.get("phone") or tags.get("contact:phone"),
        "website": tags.get("website") or tags.get("contact:website"),
        "distanceM": round(haversine_m(origin_lat, origin_lng, lat, lng)),
        "source": "overpass",
        "sourceUrl": f"https://www.openstreetmap.org/{type_key}/{el['id']}",
    }


def dedupe_pois(pois):
    """src/lib/poi.ts の dedupePois() と同一内容（名前+約11m精度の座標でキー化）。"""
    seen = {}
    for p in pois:
        key = f"{p['name'] or ''}:{p['lat']:.4f}:{p['lng']:.4f}"
        existing = seen.get(key)
        if existing is None or p["distanceM"] < existing["distanceM"]:
            seen[key] = p
    return list(seen.values())


class EndpointStats:
    """接続先ごとの成功/失敗内訳（最終レポート用）。前回チェックポイントの値から
    引き継いで累積する（複数回の実行にまたがる傾向を見るため）。
    food/otherクエリを別スレッドで並行実行するためロックで保護する。
    """

    def __init__(self, initial=None):
        self._lock = Lock()
        self.data = {url: {"success": 0, "http_error": 0, "timeout": 0, "network_error": 0, "retry": 0} for url in ENDPOINTS}
        if initial:
            for url, counts in initial.items():
                self.data.setdefault(url, {"success": 0, "http_error": 0, "timeout": 0, "network_error": 0, "retry": 0})
                for k, v in counts.items():
                    self.data[url][k] = v

    def record(self, url, outcome):
        with self._lock:
            self.data.setdefault(url, {"success": 0, "http_error": 0, "timeout": 0, "network_error": 0, "retry": 0})
            self.data[url][outcome] = self.data[url].get(outcome, 0) + 1

    def as_dict(self):
        return self.data


def fetch_one_query(url, query, stats):
    """1接続先へ1回だけ問い合わせる（同一接続先への無制限リトライはしない。
    overpass.tsのtryEndpoint()と同じ方針）。一時障害時に同じ接続先で
    待ってから再試行すると、次の（生きている）接続先への切り替えが遅れて
    1駅あたりの所要時間が膨らむため、リトライは呼び出し側(fetch_via_endpoints)で
    「全接続先を1周した後」にラウンド単位で行う。
    戻り値: (elements | None, outcome)
    """
    data = urllib.parse.urlencode({"data": query}).encode()
    try:
        req = urllib.request.Request(url, data=data, headers=REQUEST_HEADERS)
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_S) as resp:
            body = json.loads(resp.read().decode())
            stats.record(url, "success")
            return body.get("elements", []), "success"
    except urllib.error.HTTPError as e:
        stats.record(url, "http_error")
        return None, f"http_error:{e.code}"
    except urllib.error.URLError as e:
        is_timeout = "timed out" in str(e.reason).lower()
        stats.record(url, "timeout" if is_timeout else "network_error")
        return None, "timeout" if is_timeout else "network_error"
    except Exception:
        stats.record(url, "network_error")
        return None, "network_error"


def race_endpoints_once(query, stats):
    """src/lib/overpass.ts の raceEndpoints()と同じ「stagger race」方式。
    1本目を即座に開始し、STAGGER_S秒ごとに次を追加で開始する（直列に3本×
    REQUEST_TIMEOUT_S秒を待つと、先頭の接続先が不調なだけで無駄に長く
    待たされるため）。どれか1つが先に成功すればそれを採用する。
    残りのスレッドは結果を待たずに処理を進める（明示的に中断はできないが、
    各スレッドはREQUEST_TIMEOUT_S秒以内に必ず終了するため、次第に消える）。
    全滅時はNoneを返す。
    """
    def run_one(url, delay):
        if delay > 0:
            time.sleep(delay)
        return (url,) + fetch_one_query(url, query, stats)

    ex = ThreadPoolExecutor(max_workers=len(ENDPOINTS))
    futures = [ex.submit(run_one, url, i * STAGGER_S) for i, url in enumerate(ENDPOINTS)]
    last_errors = []
    winner = None
    try:
        for fut in as_completed(futures, timeout=STAGGER_S * len(ENDPOINTS) + REQUEST_TIMEOUT_S + 8):
            url, elements, outcome = fut.result()
            if elements is not None:
                winner = (elements, url)
                break
            last_errors.append(f"{url}:{outcome}")
    except FuturesTimeoutError:
        pass
    finally:
        ex.shutdown(wait=False)  # 勝者が決まったら残りは待たない（各スレッドは自然終了する）
    if winner:
        return winner[0], winner[1], []
    return None, None, last_errors


def fetch_via_endpoints(query, stats):
    """race_endpoints_once()をMAX_ROUND_RETRIES+1回まで試す。
    全接続先が1周して全滅した場合のみ、指数バックオフを挟んでもう一周する
    （「一時的に全滅」と「恒久的に全滅」を区別するための限定的な再試行）。
    全ラウンドを終えても全滅ならNoneを返す（＝呼び出し側はキャッシュを書かない＝
    APIの本当の失敗と正常な0件応答を混同しない）。
    """
    all_errors = []
    for round_i in range(MAX_ROUND_RETRIES + 1):
        elements, url, errors = race_endpoints_once(query, stats)
        if elements is not None:
            return elements, url
        all_errors.extend(errors)
        if round_i < MAX_ROUND_RETRIES:
            for u in ENDPOINTS:
                stats.record(u, "retry")
            time.sleep(BACKOFF_BASE_S * (2 ** round_i))
    print(f"    [全接続先で失敗: {'; '.join(all_errors)}]")
    return None, None


def generate_for_station(station, stats):
    lat, lng = station["lat"], station["lng"]
    food_query = build_food_query(lat, lng, RADIUS_M)
    other_query = build_other_query(lat, lng, RADIUS_M)

    # food/otherを並行実行する（overpass.tsのライブ検索と同じ理由: 直列だと2倍遅い）。
    with ThreadPoolExecutor(max_workers=2) as ex:
        food_future = ex.submit(fetch_via_endpoints, food_query, stats)
        other_future = ex.submit(fetch_via_endpoints, other_query, stats)
        food_elements, food_endpoint = food_future.result()
        other_elements, other_endpoint = other_future.result()

    # 「今回の取得」を失敗扱いにするのは両方全滅した場合のみ。
    # 片方だけ成功していれば、それだけでも保存する（部分的なデータ＞何も保存しない）。
    food_incomplete = food_elements is None
    other_incomplete = other_elements is None
    if food_incomplete and other_incomplete:
        return None

    elements = (food_elements or []) + (other_elements or [])
    pois = [normalize_element(el, lat, lng) for el in elements]
    pois = [p for p in pois if p is not None]
    pois = dedupe_pois(pois)
    pois.sort(key=lambda p: p["distanceM"])
    # Astra監査P1: ここでPOI_RESULT_LIMIT(30件)へ絞らない。src/lib/overpass.tsの
    # ライブ検索と同じ理由（全カテゴリ横断で距離順に切ると、食べる/温泉等の少数派
    # カテゴリがその他カテゴリの多数派に押し出されて静的キャッシュから消えてしまう。
    # 実際に監査で「温泉facility=yesなのにonsenカテゴリPOIが0件」の駅の多くが
    # ちょうど30件で頭打ちになっていたことから、この打ち切りが原因と確認した）。
    # カテゴリ絞り込み前の全件を保存し、「すべて」表示時の上限適用はアプリ側
    # （App.tsxのPOI_RESULT_LIMIT）に委ねる。
    endpoints_used = sorted({e for e in (food_endpoint, other_endpoint) if e})
    return {
        "stationId": station["id"],
        "lat": lat,
        "lng": lng,
        "radiusM": RADIUS_M,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        # --- Phase 11で追加した後方互換フィールド（既存フィールドは変更しない） ---
        "schemaVersion": POI_SCHEMA_VERSION,
        "source": "overpass",
        "queryVersion": QUERY_VERSION,
        # "ok" = food/otherとも正常応答（0件含む）。"partial" = 片方のみ成功
        # （Astra監査P1: 部分成功を"ok"として保存すると、未取得カテゴリを
        # 「周辺に存在しない」と誤って断定してしまう不具合の原因だったため区別する。
        # 追加フィールドのため既存の読み手（statusを見ないもの）には影響しない）。
        "status": "partial" if (food_incomplete or other_incomplete) else "ok",
        "foodIncomplete": food_incomplete,
        "otherIncomplete": other_incomplete,
        "endpointsUsed": endpoints_used,
        "pois": pois,
    }


# --- チェックポイント -------------------------------------------------------

def load_checkpoint():
    if not CHECKPOINT_PATH.exists():
        return {"schemaVersion": 1, "updatedAt": None, "stations": {}, "endpointStats": {}}
    try:
        with open(CHECKPOINT_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"schemaVersion": 1, "updatedAt": None, "stations": {}, "endpointStats": {}}


def save_checkpoint(checkpoint):
    CHECKPOINT_PATH.parent.mkdir(parents=True, exist_ok=True)
    checkpoint["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    tmp = CHECKPOINT_PATH.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(checkpoint, f, ensure_ascii=False, indent=2)
    tmp.replace(CHECKPOINT_PATH)


def is_fresh(station_id, stale_days):
    path = OUT_DIR / f"{station_id}.json"
    if not path.exists():
        return False
    try:
        with open(path, encoding="utf-8") as f:
            existing = json.load(f)
        generated_at = existing.get("generatedAt")
        if not generated_at:
            return False
        generated_ts = time.mktime(time.strptime(generated_at, "%Y-%m-%dT%H:%M:%SZ"))
        age_days = (time.time() - generated_ts) / 86400
        return age_days < stale_days
    except Exception:
        return False


def cache_age_days(station_id):
    """既存キャッシュの経過日数。未生成ならinfとして「最優先で処理すべき」扱いにする
    （--max-stationsで打ち切る週次ジョブでも、未生成の駅から先に埋まっていくように）。"""
    path = OUT_DIR / f"{station_id}.json"
    if not path.exists():
        return float("inf")
    try:
        with open(path, encoding="utf-8") as f:
            existing = json.load(f)
        generated_at = existing.get("generatedAt")
        if not generated_at:
            return float("inf")
        generated_ts = time.mktime(time.strptime(generated_at, "%Y-%m-%dT%H:%M:%SZ"))
        return (time.time() - generated_ts) / 86400
    except Exception:
        return float("inf")


def sort_by_priority(stations):
    """未生成/最も古いキャッシュを優先する順に並べ替える。
    --max-stationsで1回の実行を打ち切っても、複数回の実行（週次ジョブ等）を
    重ねるうちに全駅が均等に更新されていくようにするため。"""
    return sorted(stations, key=lambda s: cache_age_days(s["id"]), reverse=True)


def print_stats(checkpoint):
    stations = checkpoint.get("stations", {})
    ok = sum(1 for v in stations.values() if v.get("status") == "ok")
    failed = sum(1 for v in stations.values() if v.get("status") == "failed")
    zero = sum(1 for v in stations.values() if v.get("status") == "ok" and v.get("poiCount") == 0)
    partial = sum(1 for v in stations.values() if v.get("status") == "ok" and v.get("resultStatus") == "partial")
    print(f"チェックポイント集計（最終更新: {checkpoint.get('updatedAt')}）")
    print(f"  記録済み駅数: {len(stations)}  成功: {ok}  失敗: {failed}  0件成功: {zero}  部分成功: {partial}")
    print("  接続先統計:")
    for url, s in checkpoint.get("endpointStats", {}).items():
        print(f"    {url}: {s}")


def main():
    parser = argparse.ArgumentParser(description="道の駅周辺スポットの事前取得キャッシュ生成（全国版）")
    parser.add_argument("station_ids", nargs="*", help="対象の駅ID（省略時は対象条件に合う全駅）")
    parser.add_argument("--only-missing", action="store_true", help="JSON未生成の駅だけ対象にする（新鮮判定はしない）")
    parser.add_argument("--retry-failed", action="store_true", help="前回チェックポイントで失敗した駅だけ対象にする")
    parser.add_argument("--regions", type=str, default=None, help="地方IDをカンマ区切りで指定（例: tohoku,kanto）")
    parser.add_argument("--prefectures", type=str, default=None, help="都道府県名をカンマ区切りで指定（例: 青森県,岩手県）")
    parser.add_argument("--force", action="store_true", help="新鮮なキャッシュがあっても作り直す")
    parser.add_argument("--stale-days", type=int, default=DEFAULT_STALE_DAYS, help="この日数を超えたキャッシュのみ再取得する")
    parser.add_argument("--max-stations", type=int, default=None, help="1回の実行で処理する駅数の上限（週次ジョブの時間制約用）")
    parser.add_argument("--stats", action="store_true", help="通信せずチェックポイントの集計だけ表示して終了する")
    parser.add_argument("--include-pre-open", action="store_true", help="pre_open状態の駅も対象に含める（既定は除外）")
    args = parser.parse_args()

    checkpoint = load_checkpoint()
    if args.stats:
        print_stats(checkpoint)
        return

    with open(STATIONS_JSON, encoding="utf-8") as f:
        data = json.load(f)
    allowed_status = {"open"} | ({"pre_open"} if args.include_pre_open else set())
    stations = [s for s in data["stations"] if s["status"] in allowed_status]

    if args.regions:
        wanted_regions = {r.strip() for r in args.regions.split(",") if r.strip()}
        stations = [s for s in stations if region_of(s["pref"]) in wanted_regions]
    if args.prefectures:
        wanted_prefs = {p.strip() for p in args.prefectures.split(",") if p.strip()}
        stations = [s for s in stations if s["pref"] in wanted_prefs]
    if args.station_ids:
        wanted = set(args.station_ids)
        stations = [s for s in stations if s["id"] in wanted]

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    if args.retry_failed:
        failed_ids = {sid for sid, v in checkpoint.get("stations", {}).items() if v.get("status") == "failed"}
        stations = [s for s in stations if s["id"] in failed_ids]
    elif args.only_missing:
        stations = [s for s in stations if not (OUT_DIR / f"{s['id']}.json").exists()]
    elif not args.force and not args.station_ids:
        stations = [s for s in stations if not is_fresh(s["id"], args.stale_days)]

    if args.max_stations is not None:
        # 未生成/最古のキャッシュから優先的に処理する（週次ジョブが打ち切られても
        # 複数回に分けて全駅が均等に更新されていくように）。
        stations = sort_by_priority(stations)[: args.max_stations]

    print(f"対象駅数: {len(stations)}")
    stats = EndpointStats(initial=checkpoint.get("endpointStats"))

    ok = 0
    failed = []
    for i, s in enumerate(stations):
        try:
            result = generate_for_station(s, stats)
        except Exception as e:
            # 1駅の想定外の例外（デコード不正・稀なOSMタグ形状等）で数時間がかりの
            # バッチ全体を落とさない。failedとして記録し次の駅へ進む
            # （下のFAILED表示にこのエラー内容を付記する）。
            print(f"    [想定外エラー: {e!r}]")
            result = None
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        if result is None:
            print(f"[{i + 1}/{len(stations)}] {s['pref']} {s['name']}: FAILED（API失敗のためキャッシュは書かない）")
            failed.append(s["id"])
            prev = checkpoint["stations"].get(s["id"], {})
            checkpoint["stations"][s["id"]] = {
                "status": "failed",
                "attempts": prev.get("attempts", 0) + 1,
                "lastAttemptAt": now,
            }
        else:
            out_path = OUT_DIR / f"{s['id']}.json"
            # Astra監査P1: 中断耐性のため、最終パスへ直接書かず一時ファイル→os.replace()で
            # 原子的に置き換える。直接書き込みだと、実行中断（GitHub Actionsのタイムアウト・
            # 強制終了等）がちょうど書き込み中に発生した場合、中身が壊れた（あるいは0バイトの）
            # JSONファイルが public/data/poi/ に残り、それを静的キャッシュとして配信して
            # しまう恐れがある。os.replace()は同一ファイルシステム上で原子的なため、
            # 読み手は常に「更新前の完全なファイル」か「更新後の完全なファイル」のどちらかしか見ない。
            tmp_path = out_path.with_suffix(".json.tmp")
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(result, f, ensure_ascii=False, indent=2)
            os.replace(tmp_path, out_path)
            poi_count = len(result["pois"])
            is_partial = result["status"] == "partial"
            note = "（部分成功: " + ("food欠落" if result["foodIncomplete"] else "other欠落") + "）" if is_partial \
                else ("" if poi_count > 0 else "（正常応答・0件）")
            print(f"[{i + 1}/{len(stations)}] {s['pref']} {s['name']}: {poi_count}件{note} -> {out_path.name}")
            ok += 1
            checkpoint["stations"][s["id"]] = {
                "status": "ok",
                "resultStatus": result["status"],  # "ok" | "partial"（poi_cache_audit.pyでの検出用）
                "attempts": 1,
                "lastAttemptAt": now,
                "poiCount": poi_count,
                "endpointsUsed": result["endpointsUsed"],
            }
        # 一定件数ごとにチェックポイントを保存する（長時間実行の途中終了に備える）
        if (i + 1) % 10 == 0 or i == len(stations) - 1:
            checkpoint["endpointStats"] = stats.as_dict()
            save_checkpoint(checkpoint)
        if i < len(stations) - 1:
            time.sleep(REQUEST_INTERVAL_S)

    checkpoint["endpointStats"] = stats.as_dict()
    save_checkpoint(checkpoint)

    print(f"\n完了: {ok}/{len(stations)} 件生成。失敗: {len(failed)}件 {failed[:20]}{'...' if len(failed) > 20 else ''}")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
