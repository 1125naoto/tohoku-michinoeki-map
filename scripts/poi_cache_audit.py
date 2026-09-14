"""
生成済みPOI static cache（public/data/poi/*.json）の0件/少数件監査（Phase 11 STEP 8）。

「0件だから異常」と機械的に決めつけず、以下の観点で「疑わしい0件/少数件」だけを
抽出する（郊外・山間部の道の駅が食事処0件になること自体は珍しくないため）:
  - 全カテゴリ横断で0件（施設周辺に本当に何も無いとは考えにくい駅）
  - facility監査(data/facility-audit.json)で温泉=yesの駅なのに、キャッシュに
    onsenカテゴリが1件も無い（同じ施設のはずなのに検出できていない可能性）
  - 都市部と推定される駅（政令指定都市・県庁所在地に近いなど、住所に「市」を含み、
    かつ大きな都道府県人口規模の都市部）で0件（本来は密集地のはず）
  - 生成に失敗している（チェックポイント上failedのまま）駅

実行方法: python scripts/poi_cache_audit.py
出力: 標準出力にサマリと詳細一覧。data/poi_cache_audit_result.json にも保存する。
"""
import json
import sys
from pathlib import Path

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
STATIONS_JSON = ROOT / "src" / "data" / "stations.json"
FACILITY_AUDIT_JSON = ROOT / "data" / "facility-audit.json"
CHECKPOINT_PATH = ROOT / "data" / "poi_cache_checkpoint.json"
POI_DIR = ROOT / "public" / "data" / "poi"
OUT_PATH = ROOT / "data" / "poi_cache_audit_result.json"

# 大きな都市を含む都道府県（人口集中地区が多く、道の駅周辺でも通常は飲食店等が
# 一定数見つかるはず、という監査のヒントに使う。断定用途ではなく「重点確認」用）。
URBAN_PREF_HINTS = {
    "東京都", "大阪府", "神奈川県", "愛知県", "埼玉県", "千葉県", "福岡県", "北海道",
    "兵庫県", "京都府", "宮城県", "広島県", "静岡県",
}


def load_json(path, default=None):
    if not path.exists():
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def main():
    stations_data = load_json(STATIONS_JSON, {"stations": []})
    stations_by_id = {s["id"]: s for s in stations_data["stations"]}
    facility_audit = load_json(FACILITY_AUDIT_JSON, {})
    checkpoint = load_json(CHECKPOINT_PATH, {"stations": {}})

    # data/facility-audit.json の形: { ..., "entries": [{ "stationId", "onsen": {"status": "yes"|"no"|"unknown"}, ... }] }
    facility_by_id = {}
    for f in (facility_audit or {}).get("entries", []):
        facility_by_id[f.get("stationId")] = f

    cache_files = sorted(POI_DIR.glob("*.json"))
    zero_total = []
    onsen_mismatch = []
    urban_zero = []
    partial_stations = []
    failed_stations = [sid for sid, v in checkpoint.get("stations", {}).items() if v.get("status") == "failed"]
    # Astra監査P1: food/otherの片方のみ取得できた「部分成功」駅（status:"partial"）。
    # チェックポイントのresultStatus（新規フィールド。旧実行では記録されていない）と、
    # 各JSONファイル自体のstatusフィールドの両方から検出する（片方が欠けていても検出できるように）。
    partial_from_checkpoint = {sid for sid, v in checkpoint.get("stations", {}).items() if v.get("resultStatus") == "partial"}

    for path in cache_files:
        sid = path.stem
        station = stations_by_id.get(sid)
        try:
            cache = load_json(path)
        except Exception as e:
            print(f"[読み込み失敗] {sid}: {e}")
            continue
        pois = cache.get("pois", [])
        pref = station["pref"] if station else None
        name = station["name"] if station else sid

        if cache.get("status") == "partial" or sid in partial_from_checkpoint:
            partial_stations.append({
                "id": sid, "pref": pref, "name": name,
                "foodIncomplete": cache.get("foodIncomplete"),
                "otherIncomplete": cache.get("otherIncomplete"),
            })

        if len(pois) == 0:
            zero_total.append({"id": sid, "pref": pref, "name": name})
            if pref in URBAN_PREF_HINTS:
                urban_zero.append({"id": sid, "pref": pref, "name": name})

        facility = facility_by_id.get(sid)
        onsen_status = (facility or {}).get("onsen", {}).get("status") if facility else None
        if onsen_status == "yes":
            has_onsen_poi = any(p.get("category") == "onsen" for p in pois)
            if not has_onsen_poi:
                onsen_mismatch.append({"id": sid, "pref": pref, "name": name, "poiCount": len(pois)})

    result = {
        "generatedCacheFiles": len(cache_files),
        "zeroTotalCount": len(zero_total),
        "zeroTotal": zero_total,
        "urbanPrefZeroCount": len(urban_zero),
        "urbanPrefZero": urban_zero,
        "onsenFacilityButNoOnsenPoiCount": len(onsen_mismatch),
        "onsenFacilityButNoOnsenPoi": onsen_mismatch,
        "failedStationCount": len(failed_stations),
        "failedStations": failed_stations,
        "partialStationCount": len(partial_stations),
        "partialStations": partial_stations,
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"監査対象キャッシュファイル数: {len(cache_files)}")
    print(f"全カテゴリ0件: {len(zero_total)}件")
    print(f"  うち都市部県(要確認): {len(urban_zero)}件")
    for x in urban_zero[:20]:
        print(f"    - [{x['pref']}] {x['name']} ({x['id']})")
    print(f"温泉facility=yesなのにonsenカテゴリPOIが0件: {len(onsen_mismatch)}件")
    for x in onsen_mismatch[:20]:
        print(f"    - [{x['pref']}] {x['name']} ({x['id']}) 総POI{x['poiCount']}件")
    print(f"生成失敗のまま(チェックポイント上failed): {len(failed_stations)}件 {failed_stations[:20]}")
    print(f"部分成功(food/otherの片方のみ取得): {len(partial_stations)}件")
    for x in partial_stations[:20]:
        print(f"    - [{x['pref']}] {x['name']} ({x['id']}) foodIncomplete={x['foodIncomplete']} otherIncomplete={x['otherIncomplete']}")
    print(f"\n詳細: {OUT_PATH}")


if __name__ == "__main__":
    main()
