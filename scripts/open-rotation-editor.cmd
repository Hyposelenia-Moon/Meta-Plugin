@echo off
chcp 65001 >nul
setlocal
set "PORT=8791"
set "URL=http://127.0.0.1:%PORT%/"

rem 已经在跑就直接开浏览器
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 '%URL%api/roster'; if ($r.StatusCode -eq 200) { exit 0 } } catch {}; exit 1"
if %errorlevel%==0 (
  start "" "%URL%"
  exit /b 0
)

rem 没跑就起一个（最小化窗口），稍等再开浏览器
start "rotation-editor" /min cmd /c node "%~dp0rotation-editor.mjs" --port %PORT%
powershell -NoProfile -Command "Start-Sleep -Milliseconds 1500"
start "" "%URL%"
