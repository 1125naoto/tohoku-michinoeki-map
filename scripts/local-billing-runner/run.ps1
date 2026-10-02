# 道の駅ナビ: 月額プランの3か月目からの料金切替（Stripe Subscription Schedule）を、このPCのStripe CLIのログインで設定する。
# Windowsのタスク「MichinoekiNavi Billing Runner」が約10分ごとに run-hidden.vbs 経由で実行する（install.ps1 で登録）。
# - 実行のたびに専用フォルダ（このリポジトリのクローン）を origin/main に合わせ、最新のスクリプトを使う
# - キーやトークンは扱わない（Stripe CLIがOSの資格情報ストアから自分で読む）。ログに秘密値は出ない
# - 何度実行しても同じ結果（scripts/introSchedulePlan.mjs）。失敗しても顧客に不利な変更は起きない
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$logDir = Join-Path $env:LOCALAPPDATA 'MichinoekiNaviBillingRunner'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'runner.log'
if ((Test-Path $log) -and ((Get-Item $log).Length -gt 1MB)) { Move-Item -Force $log "$log.1" }

function Write-Log([string]$msg) {
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), ($msg -replace '\b(sk|rk|pk)_(live|test)_[A-Za-z0-9*]+', '[KEY]')
  Add-Content -Path $log -Value $line -Encoding UTF8
}

try {
  git -C $repo fetch -q origin main 2>&1 | Out-Null
  git -C $repo reset -q --hard origin/main 2>&1 | Out-Null
  $env:STRIPE_CLI_PROJECT = 'michinoeki-live'
  $env:INTRO_SCHEDULE_PROBE = '1'
  (node (Join-Path $repo 'scripts\apply-intro-schedules.mjs') 2>&1) | ForEach-Object { Write-Log "$_" }
  Remove-Item Env:\INTRO_SCHEDULE_PROBE
  (node (Join-Path $repo 'scripts\apply-intro-schedules.mjs') 2>&1) | ForEach-Object { Write-Log "$_" }
} catch {
  Write-Log "runner error: $($_.Exception.Message)"
}
