# ============================================================
#  道の駅ナビ スマホ実機テスト開始（FINAL）
#  「スマホ実機テスト開始.bat」から呼ばれる本体。
#  古いサーバー停止 → ブランチ/コミット確認 → クリーンビルド → ビルドID取得 →
#  プレビュー起動(localhost 200確認) → Cloudflare Quick Tunnel起動 → HTTPS URL取得 →
#  HTTPS経由で「配信中ビルドID == 今のビルドID」を証明 → URLを大きく表示。
#  batではなくPowerShellで書く理由: cmdの for /f は「=」や括弧を含むコマンドを壊すため、
#  実機テスト環境の準備のような複数ステップ処理を安全に書けない（実際に発生した不具合）。
# ============================================================
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

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
Write-Host '   道の駅ナビ スマホ実機テスト準備 (FINAL)'
Write-Host '  ============================================'
Write-Host ''

# ---- 0. 前提ツール ----
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Fail 'npm が見つかりませんでした（Node.js未インストールの可能性）' 'https://nodejs.org/ja から Node.js (LTS版) をインストールして、もう一度このファイルを実行してください'
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Fail 'git が見つかりませんでした' 'Claude Codeに「gitが見つからない」と伝えてください'
}
$cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cloudflared) {
  Fail 'cloudflared が見つかりません（HTTPS URLを準備できません。現在地機能にはHTTPSが必要です）' 'Claude Codeに「cloudflaredが無い」と伝えてください'
}

# ---- 1. 古いサーバー・古いトンネルを必ず停止 ----
Write-Host '  [1/8] 古いサーバーを停止しています...'
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
$listeners = Get-NetTCPConnection -LocalPort 4173 -State Listen -ErrorAction SilentlyContinue
foreach ($l in $listeners) { Stop-Process -Id $l.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1
if (Get-NetTCPConnection -LocalPort 4173 -State Listen -ErrorAction SilentlyContinue) {
  Fail '4173番ポートを解放できませんでした' 'PCを再起動してから、もう一度このファイルを実行してください'
}
Write-Host '    停止しました。'
Write-Host ''

# ---- 2. ブランチ / コミット ----
Write-Host '  [2/8] ブランチとコミットを確認しています...'
$branch = (git rev-parse --abbrev-ref HEAD 2>$null)
$commit = (git rev-parse HEAD 2>$null)
if (-not $commit) { Fail 'gitのコミットを確認できませんでした' 'Claude Codeに伝えてください' }
$commit = $commit.Substring(0, 12)
Write-Host "    ブランチ: $branch"
Write-Host "    コミット: $commit"
Write-Host ''

# ---- 3. クリーンビルド ----
Write-Host '  [3/8] 最新でビルドしています...(数十秒かかります)'
Write-Host ''
if (Test-Path 'dist') { Remove-Item 'dist' -Recurse -Force }
& cmd /c 'npm run build'
if ($LASTEXITCODE -ne 0) {
  Fail 'ビルドに失敗しました' '上に表示されたエラー内容をコピーしてClaude Codeに伝え、修正を依頼してください'
}
Write-Host ''

# ---- 4. ビルドID ----
Write-Host '  [4/8] ビルドIDを確認しています...'
if (-not (Test-Path 'dist\build-info.json')) { Fail 'dist\build-info.json がありません' 'Claude Codeに伝えてください' }
$info = Get-Content 'dist\build-info.json' -Raw | ConvertFrom-Json
$buildId = $info.buildId
if (-not $buildId) { Fail 'ビルドIDを読めませんでした' 'Claude Codeに伝えてください' }
Write-Host "    ビルドID: $buildId"
Write-Host ''

# ---- 5. プレビュー起動 + localhost 200 ----
Write-Host '  [5/8] プレビューサーバーを起動しています...'
Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'npm run preview' -WorkingDirectory $Root -WindowStyle Minimized
$localOk = $false
for ($i = 0; $i -lt 20 -and -not $localOk; $i++) {
  Start-Sleep -Seconds 1
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:4173/build-info.json' -TimeoutSec 3
    if ($r.StatusCode -eq 200) { $localOk = $true }
  } catch { }
}
if (-not $localOk) {
  Fail 'プレビューサーバーが起動しませんでした (http://localhost:4173)' '「スマホ実機テスト終了.bat」を実行してから、もう一度お試しください'
}
Write-Host '    起動しました (localhost HTTP 200)。'
Write-Host ''

# ---- 6/7. Cloudflare Quick Tunnel（アカウント不要）+ HTTPS経由でビルドIDを証明 ----
# QUIC(既定)は「登録は成功するがデータが流れない(530)」ことが実際にあったため http2 を使う。
# それでもHTTPS経由でビルドIDを取得できない場合は、トンネルを作り直して1回だけやり直す
# （URLは毎回変わるので、必ず最後に表示されたURLだけを使ってもらう）。
# ログは試行ごとに別ファイルにする（停止直後の旧プロセスがまだ掴んでいて削除できず、
# 古いURLを読み直してしまう事故が実際に起きたため）。最終URLは固定名のファイルにも書く。
$urlFile = Join-Path $env:TEMP 'michinoeki_https_url.txt'
if (Test-Path $urlFile) { Remove-Item $urlFile -Force -ErrorAction SilentlyContinue }
$httpsUrl = $null
$servedId = $null
for ($attempt = 1; $attempt -le 2 -and -not $servedId; $attempt++) {
  Write-Host "  [6/8] HTTPS実機テスト用のURLを準備しています...(発行10〜30秒 + DNS反映 最大90秒) [試行 $attempt/2]"
  Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
  $cfLog = Join-Path $env:TEMP ("michinoeki_cloudflared_{0}_{1}.txt" -f (Get-Date -Format 'yyyyMMddHHmmss'), $attempt)
  Start-Process -FilePath $cloudflared.Source -ArgumentList 'tunnel', '--url', 'http://localhost:4173', '--protocol', 'http2', '--logfile', $cfLog -WindowStyle Minimized
  $httpsUrl = $null
  for ($i = 0; $i -lt 45 -and -not $httpsUrl; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path $cfLog) {
      $m = Select-String -Path $cfLog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($m) { $httpsUrl = $m.Matches[0].Value }
    }
  }
  if (-not $httpsUrl) {
    Write-Host '    HTTPS URLを取得できませんでした。'
    continue
  }
  Write-Host "    発行: $httpsUrl"
  Write-Host ''
  Write-Host '  [7/8] HTTPS経由で配信中のビルドを確認しています...(新しいURLはDNS反映に時間がかかることがあります)'
  for ($i = 0; $i -lt 45 -and -not $servedId; $i++) {
    Start-Sleep -Seconds 2
    try {
      $r = Invoke-WebRequest -UseBasicParsing -Uri "$httpsUrl/build-info.json" -TimeoutSec 8
      if ($r.StatusCode -eq 200) { $servedId = ($r.Content | ConvertFrom-Json).buildId }
    } catch { }
  }
  if (-not $servedId) { Write-Host '    このURLでは配信を確認できませんでした。トンネルを作り直します...' }
}
if (-not $servedId) {
  Fail 'HTTPS URLから配信中のビルドを確認できませんでした (2回試行)' 'ネット接続を確認して、もう一度このファイルを実行してください'
}
if ($servedId -ne $buildId) {
  Fail "配信中のビルド ($servedId) が今のビルド ($buildId) と一致しません（古いサーバーが残っている可能性）" '「スマホ実機テスト終了.bat」を実行してから、もう一度このファイルを実行してください'
}
Write-Host "    一致を確認 (配信中: $servedId)。"
Write-Host ''
Set-Content -Path $urlFile -Value $httpsUrl -Encoding ASCII

# ---- 8. 完了 ----
Write-Host '  [8/8] 準備完了。'
Write-Host ''
Write-Host '  ============================================' -ForegroundColor Green
Write-Host '   スマホではこの HTTPS URL を開いてください' -ForegroundColor Green
Write-Host '  ============================================' -ForegroundColor Green
Write-Host ''
Write-Host "    $httpsUrl" -ForegroundColor Cyan
Write-Host ''
Write-Host '  ============================================'
Write-Host "    ブランチ : $branch"
Write-Host "    コミット : $commit"
Write-Host "    ビルドID : $buildId"
Write-Host ''
Write-Host '    ※ 以前のURLは無効です。必ず上のURLを使ってください。'
Write-Host '    ※ 実機の「保存」タブ一番下「動作診断」に同じビルドIDが'
Write-Host '       出ていれば、検証したものと同じ版です。'
Write-Host '    ※ 終了するときは「スマホ実機テスト終了.bat」を実行してください。'
Write-Host '       (このウィンドウを閉じてもサーバーは動き続けます)'
Write-Host '  ============================================'
Write-Host ''
Read-Host '  Enterキーで閉じます（サーバーは動き続けます）' | Out-Null
