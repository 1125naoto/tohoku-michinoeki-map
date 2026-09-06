"""
道の駅周辺スポット(POI)の事前取得キャッシュ生成スクリプト。

目的: ユーザーのスマホが毎回Overpass公開APIへ直接依存する構造をやめ、
各道の駅の周辺スポットを事前に取得して public/data/poi/<stationId>.json
として静的配信する。アプリ側はこの静的JSONをまず読み、必要なら裏で
Overpassへ再検証をかける（stale-while-revalidateと同じ考え方を
「初回訪問者にも効かせる」ために事前生成する）。

本番コード(src/lib/overpass.ts, src/lib/poi.ts)のクエリ・分類・正規化・
重複除去ロジックと同一内容をPythonで再現している（ロジックの二重管理を
避けるため、両者を変更する場合は必ず両方に反映すること）。

実行方法:
  py -3 scripts/fetch_poi_cache.py                  # 全182駅
  py -3 scripts/fetch_poi_cache.py mne-19013 mne-18990   # 指定駅のみ(PoC等)
  py -3 scripts/fetch_poi_cache.py --only-missing    # 未生成の駅だけ

出力: public/data/poi/<stationId>.json
  { "stationId", "lat", "lng", "radiusM", "generatedAt", "pois": [...] }

公開APIへの配慮として、駅ごとのリクエスト間に1.5秒のスリープを入れる。
"""
import argparse
import json
import math
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATIONS_JSON = ROOT / "src" / "data" / "stations.json"
OUT_DIR = ROOT / "public" / "data" / "poi"

# --- 本番コード(src/lib/overpass.ts)と同一の接続先・設定 ---------------------
ENDPOINTS = [
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]
RADIUS_M = 10000  # 事前生成はAUTO_ESCALATE_MAX_Mと同じ上限で最初から広めに取得する
POI_RESULT_LIMIT = 30
REQUEST_HEADERS = {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": "tohoku-michinoeki-map/1.0 (+https://github.com/1125naoto/tohoku-michinoeki-map; "
    "contact: poi-cache-generator)",
    "Referer": "https://1125naoto.github.io/tohoku-michinoeki-map/",
    "Accept": "*/*",
}


def build_query(lat, lng, radius_m):
    """src/lib/overpass.ts の buildQuery() と同一内容。"""
    around = f"(around:{radius_m},{lat},{lng})"
    return (
        "[out:json][timeout:25];"
        "("
        f'nwr["amenity"~"^(restaurant|cafe|fast_food|bar|pub|public_bath|foot_bath|shelter|place_of_worship)$"]{around};'
        f'nwr["tourism"~"^(attraction|viewpoint|museum|zoo|aquarium|camp_site|artwork|gallery|picnic_site|hotel|guest_house|hostel|motel)$"]{around};'
        f'nwr["leisure"~"^(park|spa)$"]{around};'
        f'nwr["natural"~"^(hot_spring|beach|waterfall|peak|cliff)$"]{around};'
        f'nwr["shop"~"^(confectionery|pastry)$"]{around};'
        f'nwr["highway"="rest_area"]{around};'
        ");"
        "out center body 80;"
    )


RAMEN_NAME_RE = re.compile("ラーメン|らーめん|らあめん|中華そば")
SUSHI_NAME_RE = re.compile("寿司|すし|鮨")
YAKINIKU_NAME_RE = re.compile("焼肉|焼き肉")


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
    if SUSHI_NAME_RE.search(name):
        return "sushi"
    if YAKINIKU_NAME_RE.search(name):
        return "yakiniku"
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


def fetch_elements(lat, lng, radius_m):
    """各接続先へ順に1回ずつ試行する（1つ成功したら打ち切り）。"""
    query = build_query(lat, lng, radius_m)
    data = urllib.parse.urlencode({"data": query}).encode()
    for url in ENDPOINTS:
        try:
            req = urllib.request.Request(url, data=data, headers=REQUEST_HEADERS)
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = json.loads(resp.read().decode())
                return body.get("elements", [])
        except Exception as e:
            print(f"    [failed: {url}: {e}]")
            continue
    return None


def generate_for_station(station):
    lat, lng = station["lat"], station["lng"]
    elements = fetch_elements(lat, lng, RADIUS_M)
    if elements is None:
        return None
    pois = [normalize_element(el, lat, lng) for el in elements]
    pois = [p for p in pois if p is not None]
    pois = dedupe_pois(pois)
    pois.sort(key=lambda p: p["distanceM"])
    pois = pois[:POI_RESULT_LIMIT]
    return {
        "stationId": station["id"],
        "lat": lat,
        "lng": lng,
        "radiusM": RADIUS_M,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "pois": pois,
    }


def main():
    parser = argparse.ArgumentParser(description="道の駅周辺スポットの事前取得キャッシュ生成")
    parser.add_argument("station_ids", nargs="*", help="対象の駅ID（省略時は全駅）")
    parser.add_argument("--only-missing", action="store_true", help="JSON未生成の駅だけ対象にする")
    args = parser.parse_args()

    with open(STATIONS_JSON, encoding="utf-8") as f:
        data = json.load(f)
    stations = [s for s in data["stations"] if s["status"] == "open"]

    if args.station_ids:
        wanted = set(args.station_ids)
        stations = [s for s in stations if s["id"] in wanted]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if args.only_missing:
        stations = [s for s in stations if not (OUT_DIR / f"{s['id']}.json").exists()]

    print(f"対象駅数: {len(stations)}")
    ok = 0
    failed = []
    for i, s in enumerate(stations):
        result = generate_for_station(s)
        if result is None:
            print(f"[{i + 1}/{len(stations)}] {s['pref']} {s['name']}: FAILED")
            failed.append(s["id"])
        else:
            out_path = OUT_DIR / f"{s['id']}.json"
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(result, f, ensure_ascii=False, indent=2)
            print(f"[{i + 1}/{len(stations)}] {s['pref']} {s['name']}: {len(result['pois'])}件 -> {out_path.name}")
            ok += 1
        if i < len(stations) - 1:
            time.sleep(1.5)

    print(f"\n完了: {ok}/{len(stations)} 件生成。失敗: {failed}")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
