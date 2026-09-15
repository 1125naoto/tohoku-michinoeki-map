# -*- coding: utf-8 -*-
"""
既存の全国POI static cache（public/data/poi/*.json）を、Overpassへ再取得せずに
オフラインで再分類するワンショットスクリプト。

背景: Owner実機QAで「道の駅ふくしま・10km・洋食」が0件になる不具合を監査した結果、
fetch_poi_cache.py の classify_food_genre()（src/lib/poi.ts の classifyFoodGenre()
と同一ロジック）に店名ベースの判定（居酒屋/食堂/洋食/イタリアン）を追加した
（POI_SCHEMA_VERSION 3→4）。既存cacheはPOIの生タグ(cuisine/amenity)を保持せず
既に確定した subcategory のみを保持しているため、生タグを使う分岐は再現できないが、
店名ベースの新分岐は cache に残っている `name` フィールドだけで再現できる。
そのため、Overpassへの再取得（全国backfill）を一切行わずに、food_other に
分類されている項目だけを対象に再分類する。

対象: category=='food' かつ subcategory=='food_other' の項目のみ。
（他の分類は今回変更していないため触らない。既存の正しい分類を壊さない。）
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_poi_cache import (  # noqa: E402
    IZAKAYA_NAME_RE,
    ITALIAN_NAME_RE,
    SHOKUDO_NAME_RE,
    YOSHOKU_NAME_RE,
)

POI_DIR = Path(__file__).resolve().parent.parent / "public" / "data" / "poi"
NEW_SCHEMA_VERSION = 4


def reclassify_name(name: str):
    """食_otherの項目に対して、店名だけで判定できる新規分岐のみを適用する。
    cuisineタグ由来の分岐（ramen/sushi/yakiniku等）は既にfood_otherではない
    はずなので対象外。既存のラーメン/寿司/焼肉の店名判定も、既にそちらへ
    分類済みのはずなのでここでは再チェックしない（範囲を広げない）。
    """
    if not name:
        return None
    if IZAKAYA_NAME_RE.search(name):
        return "izakaya"
    if SHOKUDO_NAME_RE.search(name):
        return "shokudo"
    if YOSHOKU_NAME_RE.search(name):
        return "yoshoku"
    if ITALIAN_NAME_RE.search(name):
        return "italian"
    return None


def main():
    files = sorted(POI_DIR.glob("mne-*.json"))
    total_files = 0
    total_reclassified = 0
    changed_files = 0
    per_subcat = {}

    for f in files:
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"[SKIP] {f.name}: read/parse error: {e}")
            continue
        total_files += 1
        pois = data.get("pois", [])
        file_changed = False
        for p in pois:
            if p.get("category") != "food" or p.get("subcategory") != "food_other":
                continue
            new_sub = reclassify_name(p.get("name") or "")
            if new_sub is None:
                continue
            p["subcategory"] = new_sub
            p["subcategories"] = [new_sub]
            total_reclassified += 1
            per_subcat[new_sub] = per_subcat.get(new_sub, 0) + 1
            file_changed = True
        if file_changed:
            data["schemaVersion"] = NEW_SCHEMA_VERSION
            f.write_text(
                json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
                newline="\n",
            )
            changed_files += 1

    print(f"対象ファイル数: {total_files}")
    print(f"再分類したファイル数: {changed_files}")
    print(f"再分類したPOI件数: {total_reclassified}")
    print(f"内訳: {json.dumps(per_subcat, ensure_ascii=False)}")


if __name__ == "__main__":
    main()
