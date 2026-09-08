@echo off
rem 道の駅ナビ スマホ実機テスト開始（FINAL）。本体は scripts\pretest-start.ps1。
rem ダブルクリックだけで、古いサーバー停止→最新ビルド→配信→HTTPS URL発行→配信中ビルドの証明まで行います。
cd /d "%~dp0"
where powershell >nul 2>nul
if errorlevel 1 (
  echo  [エラー] PowerShell が見つかりませんでした。Claude Codeに伝えてください。
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\pretest-start.ps1"