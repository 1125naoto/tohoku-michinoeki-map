@echo off
rem ============================================================
rem  道の駅ナビ スマホ実機テスト開始スクリプト (Windows)
rem  ダブルクリックするだけで、最新でビルドしてスマホから
rem  確認できる状態にします。HTTPS実機テスト用URL(Cloudflare Tunnel
rem  経由・アカウント不要)も自動で用意します。
rem  現在地機能はHTTPS接続でのみ動作します。HTTP接続ではブラウザの
rem  Secure Context制限により位置情報機能自体が使えないためです。
rem  終了するときは「スマホ実機テスト終了.bat」を実行してください。
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

rem ---- 1. 既存のプレビューサーバー(4173番ポート)とHTTPSトンネルを停止 ----
echo  [1/5] 既存のプレビューサーバーを確認しています...
set FOUND_PID=
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":4173" ^| findstr "LISTENING"') do set FOUND_PID=%%p
if defined FOUND_PID (
  echo    既存のプロセス ^(PID: !FOUND_PID!^) を停止します...
  taskkill /F /PID !FOUND_PID! >nul 2>nul
  timeout /t 1 /nobreak >nul
) else (
  echo    起動中のプレビューサーバーはありませんでした。
)
taskkill /F /IM cloudflared.exe >nul 2>nul
echo.

rem ---- 2. ビルド ----
echo  [2/5] 最新でビルドしています...^(数十秒かかります^)
echo.
call npm run build
if errorlevel 1 (
  echo.
  echo  [エラー] ビルドに失敗しました。
  echo  次にやること: 上に表示されたエラー内容を確認してください^(コードの記述ミスの可能性があります^)。
  echo  もしくは: エラー内容をコピーしてClaude Codeに伝え、修正を依頼してください。
  echo.
  pause
  exit /b 1
)
echo.
echo    ビルド完了。
echo.

rem ---- 3. LAN IPv4アドレスの取得(HTTPSが使えない場合の予備) ----
echo  [3/5] このPCのLAN IPアドレスを確認しています...
set LAN_IP=
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notmatch '^169\.254\.' -and $_.IPAddress -notmatch '^127\.' -and $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL' } | Select-Object -First 1 -ExpandProperty IPAddress)" 2^>nul`) do set LAN_IP=%%i
if not defined LAN_IP (
  set LAN_IP=このPCのIPアドレス
) else (
  echo    見つかりました: !LAN_IP!
)
echo.

rem ---- 4. プレビューサーバーを別ウィンドウで起動 ----
echo  [4/5] プレビューサーバーを起動しています...
start "michinoeki-preview" /min npm run preview
timeout /t 3 /nobreak >nul
echo    起動しました。
echo.

rem ---- 5. HTTPS実機テスト用URL(Cloudflare Tunnel)を用意 ----
echo  [5/5] HTTPS実機テスト用のURLを準備しています...^(10秒ほどかかります^)
set CF_LOG=%TEMP%\michinoeki_cloudflared_log.txt
if exist "%CF_LOG%" del /f /q "%CF_LOG%" >nul 2>nul
set HTTPS_URL=
where cloudflared >nul 2>nul
if errorlevel 1 (
  echo    [注意] cloudflaredが見つからないため、HTTPS URLは準備できませんでした。
  echo    現在地機能を試すにはHTTPS接続が必要です。下のLAN URLでは現在地機能は使えません。
) else (
  start "michinoeki-tunnel" /min cloudflared tunnel --url http://localhost:4173 --logfile "%CF_LOG%"
  set /a WAIT_COUNT=0
  :WAIT_TUNNEL
  set /a WAIT_COUNT+=1
  timeout /t 1 /nobreak >nul
  if exist "%CF_LOG%" (
    for /f "usebackq delims=" %%u in (`powershell -NoProfile -Command "$m = Select-String -Path '%CF_LOG%' -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue | Select-Object -First 1; if ^($m^) { $m.Matches[0].Value }"`) do set HTTPS_URL=%%u
  )
  if not defined HTTPS_URL (
    if !WAIT_COUNT! LSS 25 goto WAIT_TUNNEL
  )
)
echo.

echo  ============================================
echo   スマホ実機テストの準備ができました
echo  ============================================
echo.
if defined HTTPS_URL (
  echo    スマホでこちらを開いてください ^(現在地機能もこちらでのみ動作^):
  echo.
  echo    !HTTPS_URL!
  echo.
  echo    ^(Wi-Fiが違うスマホからでも開けます^)
) else (
  echo    [注意] HTTPS URLの準備に時間がかかっているか、失敗しました。
  echo    しばらくしてからこのファイルをもう一度実行してください。
)
echo.
echo    同じWi-Fi内であればこちらも使えます^(現在地機能は使えません^):
echo.
echo    http://!LAN_IP!:4173/
echo.
echo    終了するときは「スマホ実機テスト終了.bat」を実行してください。
echo    ^(このウィンドウを閉じてもサーバーは動き続けます^)
echo  ============================================
echo.
pause
