@echo off
rem 道の駅ナビ スマホ実機テスト終了（緊急時の後片付け用）。
rem 通常のQA更新（スマホ実機テスト開始.bat）はGitHub Pagesの固定URLを
rem 使うため、終了操作は不要です。これは緊急デバッグ用に一時トンネルを
rem 使った場合の後片付け（サーバー/トンネルの停止）専用です。
rem 本体は scripts\pretest-stop.ps1。
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\pretest-stop.ps1"