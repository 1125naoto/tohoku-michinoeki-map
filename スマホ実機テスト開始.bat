@echo off
rem 道の駅ナビ Owner実機QA更新（固定URL版）。本体は scripts\qa-deploy.ps1。
rem ダブルクリックだけで、最新ビルド→QA専用サイトへ反映→固定URL表示まで行います。
rem URLは毎回変わりません（ホーム画面に追加しておけば、次回からはこのbatを
rem 実行するだけで最新版に更新されます）。本番/NAMIには一切触れません。
cd /d "%~dp0"
where powershell >nul 2>nul
if errorlevel 1 (
  echo  [エラー] PowerShell が見つかりませんでした。Claude Codeに伝えてください。
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\qa-deploy.ps1"