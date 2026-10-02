"""
Google Maps周辺検索 & iPhone復帰白画面 Root Cause Audit用のfocusedなZIPを組み立てる。
最終公開監査ZIP（michinoeki-fable-final-release-audit-*.zip）とは別物で、
今回の2つのバグの原因分析に直接関係するコード・テスト・設定だけに絞る。

コード変更・commitは一切行わない（このスクリプト自体もZIPには含めない）。
"""
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "fable-audit"

# 原因分析に直接関係するファイルのみ（最終公開監査ZIPのような全ファイル同梱はしない）
RELEVANT_FILES = [
    # 外部ナビゲーション・Google Maps URL生成の中心
    "src/lib/gmaps.ts",
    "src/lib/gmaps.test.ts",
    "src/App.tsx",  # openExternal, searchOrigin, station-sheet wiring, hash/history
    "src/main.tsx",  # Service Worker登録・focus/visibilitychange自動更新
    # 周辺スポットUI・POI関連
    "src/components/PoiSearchPanel.tsx",
    "src/components/PoiDetailSheet.tsx",
    "src/lib/poi.ts",  # CATEGORY_LABEL, GOOGLE_DETAIL_KEYWORD
    # 比較対象（既存の正常動作しているGoogle Maps連携）
    "src/components/StationSheet.tsx",
    "src/components/RouteResults.tsx",
    "src/components/ManualRouteBuilder.tsx",
    # 検索地点・地図状態
    "src/components/MapView.tsx",
    "src/lib/geolocation.ts",
    # PWA/standalone判定・ビルド識別
    "src/components/DiagnosticsPanel.tsx",
    "src/lib/buildInfo.ts",
    "src/vite-env.d.ts",
    # localStorage namespace（QA/本番/NAMI分離の文脈）
    "src/lib/storageNamespace.ts",
    # PWA/vite base/QA deploy config
    "vite.config.ts",
    "scripts/qa-deploy.ps1",
    "index.html",
    "package.json",
    "package-lock.json",
    # 既存tests
    "e2e/poi.spec.ts",
]


def git_files():
    out = subprocess.run(
        ["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, check=True
    ).stdout.decode("utf-8")
    return set(p for p in out.split("\0") if p.strip())


def main():
    short_head = subprocess.run(
        ["git", "rev-parse", "--short=7", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True
    ).stdout.strip()
    full_head = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True
    ).stdout.strip()
    branch = subprocess.run(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True
    ).stdout.strip()

    tracked = git_files()
    missing_from_git = [f for f in RELEVANT_FILES if f not in tracked]
    if missing_from_git:
        print("WARNING: 以下はgit管理外（想定外）:", missing_from_git, file=sys.stderr)

    zip_name = f"michinoeki-fable-googlemaps-ios-rootcause-{short_head}.zip"
    zip_path = OUT_DIR / zip_name

    context_md = OUT_DIR / "ROOT_CAUSE_CONTEXT.md"
    if not context_md.exists():
        print("ERROR: ROOT_CAUSE_CONTEXT.md が無い", file=sys.stderr)
        sys.exit(1)

    evidence_dir = OUT_DIR / "rootcause-evidence"
    evidence_files = sorted(evidence_dir.glob("*.txt")) if evidence_dir.exists() else []

    OUT_DIR.mkdir(exist_ok=True)
    if zip_path.exists():
        zip_path.unlink()
    included = []
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for f in RELEVANT_FILES:
            p = ROOT / f
            if p.exists():
                z.write(p, arcname=f)
                included.append(f)
        z.write(context_md, arcname="ROOT_CAUSE_CONTEXT.md")
        for ef in evidence_files:
            z.write(ef, arcname=f"fable-audit/rootcause-evidence/{ef.name}")

    print(f"SOURCE_BRANCH={branch}")
    print(f"SOURCE_HEAD={full_head}")
    print(f"ZIP: {zip_path}")
    print(f"included relevant source/test files: {len(included)} / {len(RELEVANT_FILES)}")
    print(f"+ ROOT_CAUSE_CONTEXT.md, + {len(evidence_files)} evidence files")


if __name__ == "__main__":
    main()
