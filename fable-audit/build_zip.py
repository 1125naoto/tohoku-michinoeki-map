"""
Fable 5.1再監査用ZIPを組み立てる。
git ls-files（コミット済みファイル一覧）を土台にし、そこへ
fable-audit/FABLE_REAUDIT_CONTEXT.md を追加する。
node_modules/.git/dist/screenshots等は git ls-files が既に除外している
（.gitignore済みのため）。念のため危険な拡張子・パターンも二重に除外する。
"""
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "fable-audit"

EXCLUDE_PREFIXES = (
    "poi_audit.py",
    "poi_audit_result.json",
    "astra-audit/",
    "data/poi_truncation_",
    "fable-audit/",  # このZIP自身・生成スクリプトは含めない（CONTEXT.mdは個別に追加）
)
EXCLUDE_SUFFIXES = (".env", ".pem", ".key")


def git_files():
    out = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True)
    return [line for line in out.stdout.splitlines() if line.strip()]


def main():
    short_head = subprocess.run(
        ["git", "rev-parse", "--short=7", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True
    ).stdout.strip()
    zip_name = f"michinoeki-fable-reaudit-{short_head}.zip"
    zip_path = OUT_DIR / zip_name

    files = git_files()
    included = []
    skipped = []
    for f in files:
        if any(f.startswith(p) for p in EXCLUDE_PREFIXES) or f.endswith(EXCLUDE_SUFFIXES):
            skipped.append(f)
            continue
        included.append(f)

    context_md = OUT_DIR / "FABLE_REAUDIT_CONTEXT.md"
    if not context_md.exists():
        print("ERROR: FABLE_REAUDIT_CONTEXT.md が無い", file=sys.stderr)
        sys.exit(1)

    OUT_DIR.mkdir(exist_ok=True)
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for f in included:
            p = ROOT / f
            if p.exists():
                z.write(p, arcname=f)
        z.write(context_md, arcname="FABLE_REAUDIT_CONTEXT.md")

    print(f"ZIP: {zip_path}")
    print(f"included files: {len(included)} (+1 context doc)")
    print(f"skipped (owner scratch/audit-only): {len(skipped)}")
    for s in skipped:
        print(f"  - {s}")


if __name__ == "__main__":
    main()
