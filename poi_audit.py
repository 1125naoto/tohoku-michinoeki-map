"""
周辺スポット検索(Overpass)の実データ監査 v2。
本番コード(src/lib/overpass.ts / src/lib/poi.ts, ブランチ fix/pretest-ux 時点)の
クエリ・分類・検索範囲自動拡張ロジックをPythonで再現し、
東北6県から各県5駅以上=合計30駅以上で実際にAPIを叩いて検証する。

実行方法:
  1. 通常のコマンドプロンプト/PowerShell（Claude Codeを経由しないターミナル）で
     このプロジェクト直下（このファイルがある場所）を開く
  2. py -3 poi_audit.py を実行（py ランチャーが無ければ python3 poi_audit.py でも可。
     標準ライブラリのみ使用のため追加インストールは不要）

出力: poi_audit_result.json（各駅の詳細）と、実行ログに要約を表示します。
終わったら poi_audit_result.json の中身をClaude Codeに貼り付けてください。
公開APIへの配慮として、リクエスト間に1.5秒のスリープを入れています
（30駅で数分かかります）。
"""
import json
import time
import urllib.request
import urllib.parse

# --- 本番コード(src/lib/overpass.ts)と合わせる設定 -------------------------
# 優先順: private.coffee → maps.mail.ru(VK Maps) → overpass-api.de。
# 旧 overpass.kumi.systems は private.coffee へ移行済みのため対象から外した。
ENDPOINTS = [
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]
RADIUS_TIERS = [3000, 5000, 10000]  # 自動拡張の段階（本番のAUTO_ESCALATE_MAX_M=10000まで）
MIN_AUTO_RESULTS = 3  # この件数未満なら次の範囲へ自動拡張
DEFAULT_RADIUS = 3000

# ブラウザではUser-Agent/Refererは自動付与されるため本番コードでは明示不要だが、
# このスクリプトはブラウザではない（urllib）ため、Overpassの利用ポリシーに沿って
# 呼び出し元を識別できるヘッダーを明示的に付与する。
REQUEST_HEADERS = {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": "tohoku-michinoeki-map/1.0 (+https://github.com/1125naoto/tohoku-michinoeki-map; "
    "contact: dev-audit)",
    "Referer": "https://1125naoto.github.io/tohoku-michinoeki-map/",
    "Accept": "*/*",
}

# 東北6県ファイル。プロジェクト直下に置いて実行する前提のパス
STATIONS_JSON = "src/data/stations.json"


def build_query(lat, lng, radius_m):
    """src/lib/overpass.ts の buildQuery() と同一内容（宿泊タグ込み）。"""
    around = f"(around:{radius_m},{lat},{lng})"
    return (
        "[out:json][timeout:15];"
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


def classify(tags):
    """src/lib/poi.ts の classify() と同一ロジック（宿泊分類込み）。"""
    amenity = tags.get("amenity")
    tourism = tags.get("tourism")
    leisure = tags.get("leisure")
    natural = tags.get("natural")
    shop = tags.get("shop")
    highway = tags.get("highway")
    religion = tags.get("religion")

    if natural == "hot_spring":
        return "onsen"
    if amenity == "public_bath":
        return "onsen"
    if leisure == "spa":
        return "onsen"
    if amenity == "foot_bath":
        return "onsen"
    if highway == "rest_area" or tourism == "picnic_site" or amenity == "shelter":
        return "onsen"

    if amenity == "cafe":
        return "food"
    if amenity == "fast_food":
        return "food"
    if shop in ("confectionery", "pastry"):
        return "food"
    if amenity in ("restaurant", "bar", "pub"):
        return "food"

    if amenity == "place_of_worship" and religion in ("shinto", "buddhist"):
        return "tourism"
    if leisure == "park":
        return "tourism"
    if tourism == "museum":
        return "tourism"
    if tourism == "viewpoint":
        return "tourism"
    if tourism in ("zoo", "aquarium"):
        return "tourism"
    if tourism == "camp_site":
        return "tourism"
    if natural in ("beach", "waterfall", "peak", "cliff"):
        return "tourism"
    if tourism == "attraction":
        return "tourism"
    if tourism in ("artwork", "gallery"):
        return "tourism"

    if tourism in ("hotel", "motel", "guest_house", "hostel"):
        return "lodging"

    return None


def fetch(lat, lng, radius_m):
    """本番のtryEndpoint()相当: 2接続先へ順に1回ずつ試行。両方失敗ならNone。"""
    query = build_query(lat, lng, radius_m)
    for url in ENDPOINTS:
        try:
            data = urllib.parse.urlencode({"data": query}).encode()
            req = urllib.request.Request(url, data=data, headers=REQUEST_HEADERS)
            with urllib.request.urlopen(req, timeout=20) as resp:
                body = json.loads(resp.read().decode())
                return body.get("elements", [])
        except Exception as e:
            print(f"    [endpoint failed: {url}: {e}]")
            continue
    return None


def summarize(elements):
    counts = {"food": 0, "tourism": 0, "onsen": 0, "lodging": 0}
    for el in elements:
        cat = classify(el.get("tags", {}))
        if cat:
            counts[cat] += 1
    counts["all"] = sum(counts.values())
    return counts


def search_with_auto_expand(lat, lng):
    """本番のsearchNearbyPoisAuto()相当。3km→5km→10kmを自動拡張。"""
    radius = DEFAULT_RADIUS
    elements = fetch(lat, lng, radius)
    if elements is None:
        return {"api_error": True, "first_radius": radius, "final_radius": radius, "counts": None}

    counts = summarize(elements)
    while counts["all"] < MIN_AUTO_RESULTS and radius < RADIUS_TIERS[-1]:
        next_tier = next((r for r in RADIUS_TIERS if r > radius), None)
        if next_tier is None:
            break
        radius = next_tier
        elements = fetch(lat, lng, radius)
        if elements is None:
            # 拡張中に失敗した場合は直前の成功結果を採用する（本番と同じ「失敗時は広げない」方針の裏返し）
            break
        counts = summarize(elements)
    return {"api_error": False, "first_radius": DEFAULT_RADIUS, "final_radius": radius, "counts": counts}


def main():
    with open(STATIONS_JSON, encoding="utf-8") as f:
        d = json.load(f)
    stations = d["stations"]

    by_pref = {}
    for s in stations:
        by_pref.setdefault(s["pref"], []).append(s)

    sample = []
    for pref, arr in by_pref.items():
        n = len(arr)
        idxs = sorted(set(min(n - 1, round(n * i / 5)) for i in range(5)))
        for i in idxs:
            sample.append(arr[i])

    print(f"sample size: {len(sample)}")
    print("=" * 110)

    results = []
    for i, s in enumerate(sample):
        if s["status"] != "open":
            continue
        r = search_with_auto_expand(s["lat"], s["lng"])
        row = {
            "pref": s["pref"],
            "name": s["name"],
            "lat": s["lat"],
            "lng": s["lng"],
            "first_radius": r["first_radius"],
            "final_radius": r["final_radius"],
            "api_error": r["api_error"],
        }
        if r["api_error"]:
            row.update({"food": None, "tourism": None, "onsen": None, "lodging": None, "all": None, "fallback_needed": True})
            print(f"[{i}] {s['pref']} {s['name']}: API ERROR")
        else:
            c = r["counts"]
            fallback_needed = c["all"] < MIN_AUTO_RESULTS  # 10kmまで広げても少ない=fallback案内が出る条件
            row.update(
                {
                    "food": c["food"],
                    "tourism": c["tourism"],
                    "onsen": c["onsen"],
                    "lodging": c["lodging"],
                    "all": c["all"],
                    "fallback_needed": fallback_needed,
                }
            )
            expanded = " (拡張済み)" if r["final_radius"] != r["first_radius"] else ""
            print(
                f"[{i}] {s['pref']} {s['name']} r={r['final_radius']}m{expanded}: "
                f"food={c['food']} tourism={c['tourism']} onsen={c['onsen']} lodging={c['lodging']} all={c['all']}"
                f"{' [FALLBACK候補]' if fallback_needed else ''}"
            )
        results.append(row)
        time.sleep(1.5)

    print("=" * 110)
    total = len(results)
    errors = [r for r in results if r["api_error"]]
    ok = [r for r in results if not r["api_error"]]
    expanded = [r for r in ok if r["final_radius"] != r["first_radius"]]
    fallback = [r for r in results if r.get("fallback_needed")]

    def rate(key):
        vals = [r[key] for r in ok if r[key] is not None]
        if not vals:
            return "N/A"
        hit = sum(1 for v in vals if v > 0)
        return f"{hit}/{len(vals)} ({hit / len(vals) * 100:.0f}%)"

    print(f"検証駅数: {total}")
    print(f"API error: {len(errors)}")
    print(f"半径自動拡張が発生した駅数: {len(expanded)}")
    print(f"fallback相当(10kmでも{MIN_AUTO_RESULTS}件未満)の駅数: {len(fallback)}")
    print(f"food成功率(1件以上): {rate('food')}")
    print(f"tourism成功率: {rate('tourism')}")
    print(f"onsen成功率: {rate('onsen')}")
    print(f"lodging成功率: {rate('lodging')}")
    print(f"all成功率: {rate('all')}")

    print("\n県別内訳:")
    by_pref_result = {}
    for r in results:
        by_pref_result.setdefault(r["pref"], []).append(r)
    for pref, rows in by_pref_result.items():
        oks = [x for x in rows if not x["api_error"]]
        all_hit = sum(1 for x in oks if x["all"] and x["all"] > 0)
        print(f"  {pref}: {len(rows)}駅 検証, all成功 {all_hit}/{len(oks) if oks else 0}")

    with open("poi_audit_result.json", "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print("\nsaved poi_audit_result.json")


if __name__ == "__main__":
    main()
