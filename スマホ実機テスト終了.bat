@echo off
rem ============================================================
rem  道の駅ナビ スマホ実機テスト終了スクリプト (Windows)
rem  「スマホ実機テスト開始.bat」で起動したプレビューサーバーを停止します。
rem ============================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo  ============================================
echo   スマホ実機テストを終了しています...
echo  ============================================
echo.

set FOUND_PID=
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":4173" ^| findstr "LISTENING"') do set FOUND_PID=%%p

if defined FOUND_PID (
  taskkill /F /PID !FOUND_PID! >nul 2>nul
  if errorlevel 1 (
    echo  [エラー] プレビューサーバー ^(PID: !FOUND_PID!^) の停止に失敗しました。
    echo  次にやること: タスクマネージャーから node.exe を手動で終了してください。
  ) else (
    echo  プレビューサーバーを停止しました。
  )
) else (
  echo  起動中のプレビューサーバーは見つかりませんでした。
  echo  （すでに停止しているか、「スマホ実機テスト開始.bat」のウィンドウを閉じてすでに終了している可能性があります）
)

echo.
pause
