# 道の駅ナビ スマホ実機テスト終了。「スマホ実機テスト終了.bat」から呼ばれる本体。
# 開始スクリプトが起動したプレビューサーバー(4173)とHTTPSトンネル(cloudflared)を停止する。
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Write-Host ''
Write-Host '  ============================================'
Write-Host '   スマホ実機テストを終了しています...'
Write-Host '  ============================================'
Write-Host ''
$listeners = @(Get-NetTCPConnection -LocalPort 4173 -State Listen -ErrorAction SilentlyContinue)
if ($listeners.Count -gt 0) {
  foreach ($l in $listeners) { Stop-Process -Id $l.OwningProcess -Force -ErrorAction SilentlyContinue }
  Write-Host '  プレビューサーバーを停止しました。'
} else {
  Write-Host '  起動中のプレビューサーバーは見つかりませんでした。'
}
$cf = @(Get-Process cloudflared -ErrorAction SilentlyContinue)
if ($cf.Count -gt 0) {
  $cf | Stop-Process -Force -ErrorAction SilentlyContinue
  Write-Host '  HTTPSトンネルを停止しました。'
} else {
  Write-Host '  起動中のHTTPSトンネルは見つかりませんでした。'
}
Write-Host ''
Read-Host '  Enterキーで閉じます' | Out-Null
