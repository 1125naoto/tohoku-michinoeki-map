"""
Astra 販売前 Final Audit パッケージ（v1.1.0-rc2）を組み立てる。

fable-audit/build_final_audit_zip.py と同じ方式:
git ls-files（＝現在HEADでコミット済みのファイル）を土台にし、
そこへ ASTRA_AUDIT_CONTEXT.md と astra-audit/evidence/（RC2 HEADで採取した
TypeScript/Vitest/git の生ログ）を加える。

node_modules / .git / dist 等は git ls-files の時点で対象外（.gitignore済み）。
Ownerのscratchファイル・過去の監査パッケージ自身は明示的に除外する。
このスクリプトはアプリコードを一切変更しない。
"""
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "astra-audit"

EXPECTED_HEAD = "272d30466a1839057db75b193e2a8f91ff419d7e"
RC_TAG = "v1.1.0-rc2"

# Owner scratch / 過去の監査パッケージ自身 / 生成スクリプト
EXCLUDE_PREFIXES = (
    "poi_audit.py",
    "poi_audit_result.json",
    "data/poi_truncation_",
    "fable-audit/",
    "astra-audit/",  # CONTEXT.md と evidence/ は下で個別に追加する
)
EXCLUDE_SUFFIXES = (".env", ".pem", ".key")
SECRET_NAME_HINTS = ("secret", "credential", "password", "token", ".env.")


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=ROOT, capture_output=True, text=True, check=True
    ).stdout.strip()


def git_files() -> list[str]:
    # -z: NUL区切り。core.quotepathで日本語パスがエスケープされるのを避ける
    out = subprocess.run(
        ["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, check=True
    ).stdout.decode("utf-8")
    return [p for p in out.split("\0") if p.strip()]


def main() -> int:
    head = git("rev-parse", "HEAD")
    short_head = git("rev-parse", "--short=8", "HEAD")
    branch = git("rev-parse", "--abbrev-ref", "HEAD")

    if head != EXPECTED_HEAD:
        print(f"[中止] HEADが想定と違います: {head} != {EXPECTED_HEAD}")
        return 1
    if git("rev-list", "-n1", RC_TAG) != head:
        print(f"[中止] {RC_TAG} がHEADを指していません")
        return 1
    if git("status", "--porcelain", "-uno"):
        print("[中止] tracked worktreeがdirtyです")
        return 1

    zip_name = f"michinoeki-v1.1.0-rc2-astra-sales-final-audit-{short_head}.zip"
    zip_path = OUT_DIR / zip_name

    included: list[str] = []
    skipped: list[str] = []
    flagged: list[str] = []
    for f in git_files():
        if any(f.startswith(p) for p in EXCLUDE_PREFIXES) or f.endswith(EXCLUDE_SUFFIXES):
            skipped.append(f)
            continue
        if any(h in f.lower() for h in SECRET_NAME_HINTS):
            flagged.append(f)
            skipped.append(f)
            continue
        included.append(f)

    extras = [
        "astra-audit/ASTRA_AUDIT_CONTEXT.md",
        *sorted(str(p.relative_to(ROOT)).replace("\\", "/") for p in (OUT_DIR / "evidence").glob("*.txt")),
    ]

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for f in included + extras:
            src = ROOT / f
            if not src.is_file():
                print(f"[警告] 見つからないためスキップ: {f}")
                continue
            z.write(src, f)

    manifest = OUT_DIR / "zip_manifest.txt"
    with manifest.open("w", encoding="utf-8") as m:
        m.write(f"# {zip_name}\n")
        m.write(f"RC_TAG={RC_TAG}\nHEAD={head}\nBRANCH={branch}\n")
        m.write(f"included={len(included) + len(extras)} skipped={len(skipped)}\n\n")
        for f in included + extras:
            m.write(f + "\n")

    print(f"ZIP: {zip_path}")
    print(f"size_bytes={zip_path.stat().st_size}")
    print(f"included={len(included) + len(extras)} skipped={len(skipped)}")
    print(f"secret_name_flagged={flagged if flagged else 'なし'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
