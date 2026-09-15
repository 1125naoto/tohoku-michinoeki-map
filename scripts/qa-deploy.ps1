# 道の駅ナビ QA/staging デプロイ（Owner実機QA用の固定URL）。
# 「スマホ実機テスト開始.bat」から呼ばれる本体。
#
# 本番/NAMIリポジトリ(tohoku-michinoeki-map / tohoku-michinoeki-nami)には一切触れない。
# 専用リポジトリ(tohoku-michinoeki-map-qa)のmainブランチへ、ビルド成果物(dist/)だけを
# 単独コミットとしてforce pushする（履歴は持たず常に最新1件のみ）。
# GitHub PagesはそのリポジトリのGitHub Actions経由で自動的に配信を更新する。
#
# 認証は `gh auth login` 済みのGit Credential Managerをそのまま利用する
# （Ownerに追加のログイン操作は不要。既にこの端末でClaude Codeがセットアップ済み）。

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$QA_REPO_URL = 'https://github.com/1125naoto/tohoku-michinoeki-map-qa.git'
$QA_PAGES_URL = 'https://1125naoto.github.io/tohoku-michinoeki-map-qa/'
$QA_DEPLOY_BASE = '/tohoku-michinoeki-map-qa/'
$QA_STORAGE_NS = 'qa'

function Fail([string]$msg, [string]$next) {
  Write-Host ''
  Write-Host "  [エラー] $msg" -ForegroundColor Red
  if ($next) { Write-Host "  次にやること: $next" -ForegroundColor Yellow }
  Write-Host ''
  Read-Host '  Enterキーで閉じます' | Out-Null
  exit 1
}

Write-Host ''
Write-Host '  ============================================'
Write-Host '   道の駅ナビ QA更新 (固定URL・GitHub Pages)'
Write-Host '  ============================================'
Write-Host ''

# ---- 0. 前提ツール ----
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Fail 'npm が見つかりませんでした（Node.js未インストールの可能性）' 'Claude Codeに伝えてください'
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Fail 'git が見つかりませんでした' 'Claude Codeに伝えてください'
}

# ---- 1. ブランチ / コミット ----
Write-Host '  [1/6] ブランチとコミットを確認しています...'
$branch = (git rev-parse --abbrev-ref HEAD 2>$null)
$commit = (git rev-parse HEAD 2>$null)
if (-not $commit) { Fail 'gitのコミットを確認できませんでした' 'Claude Codeに伝えてください' }
$commit = $commit.Substring(0, 12)
Write-Host "    ブランチ: $branch"
Write-Host "    コミット: $commit"
Write-Host ''

# ---- 2. QAビルド ----
Write-Host '  [2/6] QA用にビルドしています...(数十秒かかります)'
Write-Host ''
if (Test-Path 'dist') { Remove-Item 'dist' -Recurse -Force }
$env:DEPLOY_BASE = $QA_DEPLOY_BASE
$env:VITE_STORAGE_NS = $QA_STORAGE_NS
& cmd /c 'npm run build'
$buildExit = $LASTEXITCODE
Remove-Item Env:\DEPLOY_BASE -ErrorAction SilentlyContinue
Remove-Item Env:\VITE_STORAGE_NS -ErrorAction SilentlyContinue
if ($buildExit -ne 0) {
  Fail 'ビルドに失敗しました' '上に表示されたエラー内容をコピーしてClaude Codeに伝え、修正を依頼してください'
}
Write-Host ''

# ---- 3. ビルドID ----
Write-Host '  [3/6] ビルドIDを確認しています...'
if (-not (Test-Path 'dist\build-info.json')) { Fail 'dist\build-info.json がありません' 'Claude Codeに伝えてください' }
$info = Get-Content 'dist\build-info.json' -Raw | ConvertFrom-Json
$buildId = $info.buildId
if (-not $buildId) { Fail 'ビルドIDを読めませんでした' 'Claude Codeに伝えてください' }
Write-Host "    ビルドID: $buildId"
Write-Host ''

# ---- 4. QA専用リポジトリへpush（本番/NAMIには一切触れない） ----
Write-Host '  [4/6] QA専用リポジトリへ反映しています...'
$qaGitDir = Join-Path $env:TEMP 'michinoeki-qa-push'
if (Test-Path $qaGitDir) { Remove-Item $qaGitDir -Recurse -Force }
New-Item -ItemType Directory -Path $qaGitDir | Out-Null
Copy-Item -Path 'dist\*' -Destination $qaGitDir -Recurse -Force
# GitHub PagesにJekyll処理をさせない（_始まりのファイルを含むアセット構成のため）
New-Item -ItemType File -Path (Join-Path $qaGitDir '.nojekyll') -Force | Out-Null

Push-Location $qaGitDir
git init -q -b main
git config user.name "michinoeki-qa-deploy"
git config user.email "qa-deploy@localhost"
git add -A
git commit -q -m "QA deploy: $buildId ($commit)"
git remote add origin $QA_REPO_URL
git push --force origin main 2>&1 | Out-Null
$pushExit = $LASTEXITCODE
Pop-Location
Remove-Item $qaGitDir -Recurse -Force -ErrorAction SilentlyContinue

if ($pushExit -ne 0) {
  Fail 'QAリポジトリへのpushに失敗しました（ネット接続 or GitHub認証を確認してください）' 'Claude Codeに伝えてください'
}
Write-Host '    反映しました。'
Write-Host ''

# ---- 5. GitHub Pagesへの反映を待って確認 ----
Write-Host '  [5/6] GitHub Pagesへの反映を待っています...(最大2分)'
$servedId = $null
for ($i = 0; $i -lt 24 -and -not $servedId; $i++) {
  Start-Sleep -Seconds 5
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri "$QA_PAGES_URL`build-info.json?t=$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())" -TimeoutSec 8
    if ($r.StatusCode -eq 200) {
      $remoteId = ($r.Content | ConvertFrom-Json).buildId
      if ($remoteId -eq $buildId) { $servedId = $remoteId }
    }
  } catch { }
}
if (-not $servedId) {
  Write-Host '    まだ反映を確認できていません（GitHub Pages側の反映に数分かかることがあります）。' -ForegroundColor Yellow
  Write-Host '    数分後にスマホでURLを開き直してみてください。'
} else {
  Write-Host "    反映を確認しました (配信中: $servedId)。"
}
Write-Host ''

# ---- 6. 完了 ----
Write-Host '  [6/6] 準備完了。'
Write-Host ''
Write-Host '  ============================================' -ForegroundColor Green
Write-Host '   スマホではこの固定URLを開いてください' -ForegroundColor Green
Write-Host '   （このURLは今後も変わりません。ホーム画面に' -ForegroundColor Green
Write-Host '     追加しておけば、次回からはbatを実行するだけで' -ForegroundColor Green
Write-Host '     最新版に更新されます）' -ForegroundColor Green
Write-Host '  ============================================' -ForegroundColor Green
Write-Host ''
Write-Host "    $QA_PAGES_URL" -ForegroundColor Cyan
Write-Host ''
Write-Host '  ============================================'
Write-Host "    ブランチ : $branch"
Write-Host "    コミット : $commit"
Write-Host "    ビルドID : $buildId"
Write-Host ''
Write-Host '    ※ 実機の「保存」タブ一番下「動作診断」の「環境」が'
Write-Host '       「QA/staging」、ビルドIDが上と同じであれば'
Write-Host '       今回の最新版を見ています。'
Write-Host '    ※ これは本番/NAMIとは別のQA専用サイトです。'
Write-Host '  ============================================'
Write-Host ''
Read-Host '  Enterキーで閉じます' | Out-Null
