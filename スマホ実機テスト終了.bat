@echo off
rem 道の駅ナビ スマホ実機テスト終了。本体は scripts\pretest-stop.ps1。
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\pretest-stop.ps1"