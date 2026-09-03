@echo off
rem ============================================================
rem  東北・道の駅制覇マップ 起動スクリプト (Windows)
rem  ダブルクリックするだけで起動します。
rem  終了するには、このウィンドウを閉じてください（サーバーも停止します）。
rem ============================================================
cd /d "%~dp0"

echo.
echo  ============================================
echo   東北・道の駅制覇マップ を起動しています...
echo  ============================================
echo.

rem ---- 1. Node.js の確認 ----
where node >nul 2>nul
if errorlevel 1 (
  echo  [エラー] Node.js が見つかりません。
  echo  https://nodejs.org/ja から LTS 版をインストールしてから、
  echo  もう一度このファイルをダブルクリックしてください。
  echo.
  pause
  exit /b 1
)

rem ---- 2. 依存関係のインストール（初回のみ） ----
if not exist "node_modules" (
  echo  初回セットアップ中です。数分かかることがあります...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo  [エラー] 依存関係のインストールに失敗しました。
    echo  インターネット接続を確認して、もう一度お試しください。
    echo.
    pause
    exit /b 1
  )
)

rem ---- 3. 本番ビルド（初回 or dist が無い場合のみ） ----
if not exist "dist\index.html" (
  echo  アプリをビルドしています...
  call npm run build
  if errorlevel 1 (
    echo.
    echo  [エラー] ビルドに失敗しました。
    echo.
    pause
    exit /b 1
  )
)

rem ---- 4. サーバー起動（IPv4含む全アドレスにバインド） ----
echo  サーバーを起動しています...
start "michinoeki-server" /b cmd /c "npm run preview >nul 2>nul"

rem ---- 5. 起動確認ができてからブラウザを開く ----
rem （確認できない場合はブラウザを開かない = 古いオフラインキャッシュ画面との混同を防ぐ）
set TRIES=0
:waitloop
curl -s -o nul -m 2 http://127.0.0.1:4173/
if not errorlevel 1 goto ready
set /a TRIES+=1
if %TRIES% geq 30 goto fail
timeout /t 1 /nobreak >nul
goto waitloop

:ready
echo.
echo  サーバーの起動を確認しました: http://127.0.0.1:4173
echo  ブラウザを開きます。
start "" "http://127.0.0.1:4173"
echo.
echo  ============================================
echo   起動完了。このウィンドウは閉じないでください。
echo   終了するときは、このウィンドウを閉じてください。
echo  ============================================
pause >nul
exit /b 0

:fail
echo.
echo  [エラー] サーバーの起動を確認できませんでした。
echo  古いキャッシュ画面と混同しないよう、ブラウザは開きません。
echo  ポート4173が他のアプリで使用されていないか確認してください。
echo.
pause
exit /b 1