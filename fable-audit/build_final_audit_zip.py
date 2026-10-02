"""
Fable 5.1 最終販売・公開可否監査ZIPを組み立てる。

git ls-files（コミット済みファイル一覧＝現在HEADの事実）を土台にし、
そこへ FABLE_AUDIT_CONTEXT.md と fable-audit/evidence/（今回のHEADに対して
新たに実行したTypeScript/Vitest結果・git履歴情報）を追加する。

node_modules/.git/dist等は git ls-files が既に対象外（.gitignore済み）。
Ownerの無関係なscratchファイル・旧監査パッケージ自身は明示的に除外する。
"""
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "fable-audit"

# Owner scratch / 過去の監査パッケージ自身 / 今回対象外のもの
EXCLUDE_PREFIXES = (
    "poi_audit.py",
    "poi_audit_result.json",
    "astra-audit/",
    "data/poi_truncation_",
    "fable-audit/",  # このZIP自身・旧パッケージ・生成スクリプトは含めない（CONTEXT.md/evidenceは個別に追加）
)
EXCLUDE_SUFFIXES = (".env", ".pem", ".key")
# 秘密情報の疑いがある語（念のための二重チェック。ファイル名ベース）
SECRET_NAME_HINTS = ("secret", "credential", "password", "token", ".env.")


def git_files():
    # -z: NUL区切り・core.quotepathの影響を受けない生のUTF-8パスを得る
    # （日本語ファイル名がエスケープされ「存在しない」扱いになる問題の回避）
    out = subprocess.run(
        ["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, check=True
    ).stdout.decode("utf-8")
    return [p for p in out.split("\0") if p.strip()]


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

    zip_name = f"michinoeki-fable-final-release-audit-{short_head}.zip"
    zip_path = OUT_DIR / zip_name

    files = git_files()
    included = []
    skipped = []
    flagged_secret_name = []
    for f in files:
        if any(f.startswith(p) for p in EXCLUDE_PREFIXES) or f.endswith(EXCLUDE_SUFFIXES):
            skipped.append(f)
            continue
        low = f.lower()
        if any(h in low for h in SECRET_NAME_HINTS):
            flagged_secret_name.append(f)
        included.append(f)

    context_md = OUT_DIR / "FABLE_AUDIT_CONTEXT.md"
    if not context_md.exists():
        print("ERROR: FABLE_AUDIT_CONTEXT.md が無い", file=sys.stderr)
        sys.exit(1)

    evidence_dir = OUT_DIR / "evidence"
    evidence_files = sorted(evidence_dir.glob("*.txt")) if evidence_dir.exists() else []

    OUT_DIR.mkdir(exist_ok=True)
    if zip_path.exists():
        zip_path.unlink()
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for f in included:
            p = ROOT / f
            if p.exists():
                z.write(p, arcname=f)
        z.write(context_md, arcname="FABLE_AUDIT_CONTEXT.md")
        for ef in evidence_files:
            z.write(ef, arcname=f"fable-audit/evidence/{ef.name}")

    print(f"SOURCE_BRANCH={branch}")
    print(f"SOURCE_HEAD={full_head}")
    print(f"ZIP: {zip_path}")
    print(f"included files (git-tracked): {len(included)}")
    print(f"+ FABLE_AUDIT_CONTEXT.md, + {len(evidence_files)} evidence files")
    print(f"skipped (owner scratch/audit-only): {len(skipped)}")
    for s in skipped:
        print(f"  - {s}")
    if flagged_secret_name:
        print(f"NOTE: filename contains secret-related keyword (review manually): {len(flagged_secret_name)}")
        for s in flagged_secret_name:
            print(f"  ? {s}")


if __name__ == "__main__":
    main()
