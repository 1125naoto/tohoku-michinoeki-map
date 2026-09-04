@echo off
rem ============================================================
rem  道の駅ナビ スマホ実機テスト開始スクリプト (Windows)
rem  ダブルクリックするだけで、最新版をビルドしてスマホから
rem  確認できる状態にします。
rem  終了するときは、このウィンドウを閉じてください（サーバーも止まります）。
rem ============================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo  ============================================
echo   道の駅ナビ スマホ実機テスト準備
echo  ============================================
echo.

rem ---- 0. npm の確認 ----
where npm >nul 2>nul
if errorlevel 1 (
  echo  [エラー] npm が見つかりませんでした。
  echo  原因: Node.js がインストールされていない可能性があります。
  echo  次にやること: https://nodejs.org/ja から Node.js ^(LTS版^) をインストールしてから、
  echo  もう一度このファイルをダブルクリックしてください。
  echo.
  pause
  exit /b 1
)

rem ---- 1. 既存のプレビューサーバー(4173番ポート)を停止 ----
echo  [1/4] 既存のプレビューサーバーを確認しています...
set FOUND_PID=
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":4173" ^| findstr "LISTENING"') do set FOUND_PID=%%p
if defined FOUND_PID (
  echo    既存のプロセス ^(PID: !FOUND_PID!^) を停止します...
  taskkill /F /PID !FOUND_PID! >nul 2>nul
  timeout /t 1 /nobreak >nul
) else (
  echo    起動中のプレビューサーバーはありませんでした。
)
echo.

rem ---- 2. ビルド ----
echo  [2/4] 最新版をビルドしています...^(数十秒かかります^)
echo.
call npm run build
if errorlevel 1 (
  echo.
  echo  [エラー] ビルドに失敗しました。
  echo  原因: 上に表示されたエラー内容を確認してください^(コードの記述ミスの可能性があります^)。
  echo  次にやること: エラー内容をコピーしてClaude Codeに伝え、修正を依頼してください。
  echo.
  pause
  exit /b 1
)
echo.
echo    ビルド成功。
echo.

rem ---- 3. LAN IPv4アドレスの取得 ----
echo  [3/4] このPCのLAN IPアドレスを確認しています...
set LAN_IP=
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notmatch '^169\.254\.' -and $_.IPAddress -notmatch '^127\.' -and $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL' } | Select-Object -First 1 -ExpandProperty IPAddress)" 2^>nul`) do set LAN_IP=%%i
if not defined LAN_IP (
  echo    [警告] LAN IPアドレスを自動取得できませんでした。
  echo    原因: PCがWi-Fi/LANに接続されていないか、取得方法が環境に合わなかった可能性があります。
  echo    次にやること: コマンドプロンプトで「ipconfig」を実行し、IPv4アドレスをご自身で確認してください。
  set LAN_IP=このPCのIPアドレス
) else (
  echo    見つかりました: !LAN_IP!
)
echo.

rem ---- 4. プレビューサーバー起動 ----
echo  [4/4] プレビューサーバーを起動します...
echo.
echo  ============================================
echo    スマホ実機テスト準備完了
echo  ============================================
echo.
echo    スマホでこちらを開いてください:
echo.
echo    http://!LAN_IP!:4173/
echo.
echo    ※PCとスマホを同じWi-Fiに接続してください
echo    ※このウィンドウを閉じるとテストが終了します
echo  ============================================
echo.

call npm run preview
if errorlevel 1 (
  echo.
  echo  [エラー] プレビューサーバーの起動に失敗しました。
  echo  原因: 4173番ポートが他のアプリで使用中の可能性があります。
  echo  次にやること: 「スマホ実機テスト終了.bat」を実行してから、もう一度お試しください。
  echo  それでも解決しない場合はPCを再起動してからお試しください。
  echo.
  pause
  exit /b 1
)

echo.
echo  プレビューサーバーが終了しました。
pause
