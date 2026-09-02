@echo off
rem ============================================================
rem  東北・道の駅制覇マップ 起動スクリプト (Windows)
rem  ダブルクリックするだけで起動します。
rem  停止するには、このウィンドウで Ctrl+C を押すか、ウィンドウを閉じてください。
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
    echo  このウィンドウのエラーメッセージを確認してください。
    echo.
    pause
    exit /b 1
  )
)

rem ---- 4. ブラウザを開いてローカルサーバー起動 ----
echo.
echo  ブラウザで http://localhost:4173 を開きます。
echo  終了するには、このウィンドウで Ctrl+C を押してください。
echo.
start "" "http://localhost:4173"
call npm run preview
if errorlevel 1 (
  echo.
  echo  [エラー] サーバーの起動に失敗しました。
  echo  ポート4173が他のアプリで使用されていないか確認してください。
  echo.
  pause
  exit /b 1
)
